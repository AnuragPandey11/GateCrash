package com.gatecrash.property;

import com.gatecrash.common.audit.AuditAction;
import com.gatecrash.common.audit.AuditService;
import com.gatecrash.common.exception.BusinessValidationException;
import com.gatecrash.common.exception.ConflictException;
import com.gatecrash.common.exception.NotFoundException;
import com.gatecrash.common.tenant.TenantContext;
import com.gatecrash.property.dto.PropertyDtos.BulkCreateRequest;
import com.gatecrash.property.dto.PropertyDtos.BulkCreateResponse;
import com.gatecrash.property.dto.PropertyDtos.CreateNodeRequest;
import com.gatecrash.property.dto.PropertyDtos.DefineLevelsRequest;
import com.gatecrash.property.dto.PropertyDtos.LevelSpec;
import com.gatecrash.property.dto.PropertyDtos.PropertyLevelResponse;
import com.gatecrash.property.dto.PropertyDtos.PropertyNodeResponse;
import com.gatecrash.property.dto.PropertyDtos.PropertyProfileResponse;
import com.gatecrash.property.dto.PropertyDtos.PropertyTypeOption;
import com.gatecrash.property.dto.PropertyDtos.SetOccupancyRequest;
import com.gatecrash.property.dto.PropertyDtos.SetPropertyTypeRequest;
import com.gatecrash.property.dto.PropertyDtos.UpdateNodeRequest;
import com.gatecrash.township.Township;
import com.gatecrash.township.TownshipRepository;
import com.gatecrash.user.AppUserRepository;
import com.gatecrash.user.UserRole;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * The property tree: a township's level definitions and the nodes filed against them.
 *
 * <p>Every read and write is anchored on {@link TenantContext}'s township, and point lookups
 * resolve by {@code (id, townshipId)} rather than id alone -- a node id from another township
 * is a 404, never a 403, because the two answers differ in what they disclose.
 *
 * <p><b>Nomenclature is never load-bearing here.</b> Nothing in this class branches on a
 * level's {@code singular}/{@code plural}; every decision is made on {@link PropertyNodeKind}.
 * That separation is what lets a developer rename "Flat" to "Villa" in the console without
 * changing which rows any query matches.
 *
 * <p>Deletion is refused while anything references the row, matching the rule the old
 * {@code TownshipService} set: blocks, flats and gates are pointed at by residents and by every
 * historical visitor log, so a cascading delete would tear holes in the access-control record.
 */
@Service
@RequiredArgsConstructor
public class PropertyService {

    private final PropertyNodeRepository nodes;
    private final PropertyLevelRepository levels;
    private final TownshipRepository townships;
    private final AppUserRepository users;
    private final AuditService audit;

    /**
     * Used only to refresh a freshly inserted node so it carries the depth, path and is_unit the
     * database trigger derived for it.
     */
    @PersistenceContext
    private EntityManager entityManager;

    // ----- profile and levels -----------------------------------------------------------------

    @PreAuthorize("hasAnyRole('ADMIN','GUARD')")
    @Transactional(readOnly = true)
    public PropertyProfileResponse profile() {
        UUID townshipId = TenantContext.requireTownshipId();
        Township township = currentTownship();
        List<PropertyLevelResponse> defined = levels.findByTownship_IdOrderByDepthAsc(townshipId)
                .stream()
                .map(l -> new PropertyLevelResponse(l.getId(), l.getDepth(), l.getKind(),
                        l.getSingular(), l.getPlural(),
                        nodes.findByTownship_IdAndDepthOrderByNameAsc(townshipId, l.getDepth()).size()))
                .toList();
        return new PropertyProfileResponse(
                township.getPropertyType(),
                township.getPropertyType().displayName(),
                defined.stream().anyMatch(l -> l.kind() == PropertyNodeKind.FLOOR),
                defined);
    }

    /**
     * Replaces the whole level set. Refused once any node exists, because re-depthing a populated
     * tree is not an edit -- inserting a Floor level under a tower that already holds flats would
     * leave those flats one level shallower than the definition says they are, and there is no
     * safe automatic answer to which floor each of them belongs on.
     */
    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public PropertyProfileResponse defineLevels(DefineLevelsRequest request) {
        UUID townshipId = TenantContext.requireTownshipId();
        if (!nodes.findByTownship_IdOrderByDepthAscNameAsc(townshipId).isEmpty()) {
            throw new ConflictException("PROPERTY_TREE_NOT_EMPTY",
                    "Levels can only be redefined while the township has no blocks, floors or units. "
                            + "Delete the existing structure first, or rename the levels instead.");
        }
        validateLevelShape(request.levels());

        levels.deleteAll(levels.findByTownship_IdOrderByDepthAsc(townshipId));
        levels.flush();

        Township township = currentTownship();
        for (int depth = 0; depth < request.levels().size(); depth++) {
            LevelSpec spec = request.levels().get(depth);
            PropertyLevel level = new PropertyLevel();
            level.setTownship(township);
            level.setDepth(depth);
            level.setKind(spec.kind());
            level.setSingular(spec.singular().trim());
            level.setPlural(spec.plural().trim());
            levels.save(level);
        }
        audit.record(AuditAction.PROPERTY_LEVELS_DEFINED, "township", townshipId,
                AuditService.detail("levels", request.levels().stream()
                        .map(s -> s.kind() + ":" + s.singular()).toList()));
        return profile();
    }

    /**
     * Renames the levels in place, keeping the shape. This is the safe counterpart to
     * {@link #defineLevels}: relabelling "Block" to "Tower" changes nothing structural, so it
     * stays available after the tree is populated -- which is when a developer actually notices
     * the wording is wrong.
     */
    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public PropertyProfileResponse renameLevel(UUID levelId, String singular, String plural) {
        UUID townshipId = TenantContext.requireTownshipId();
        PropertyLevel level = levels.findByIdAndTownship_Id(levelId, townshipId)
                .orElseThrow(() -> NotFoundException.of("Property level", levelId));
        level.setSingular(requireLabel(singular, "singular"));
        level.setPlural(requireLabel(plural, "plural"));
        levels.save(level);
        audit.record(AuditAction.PROPERTY_LEVELS_DEFINED, "property_level", levelId,
                AuditService.detail("singular", level.getSingular(), "plural", level.getPlural()));
        return profile();
    }

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public PropertyProfileResponse setPropertyType(SetPropertyTypeRequest request) {
        UUID townshipId = TenantContext.requireTownshipId();
        Township township = currentTownship();
        PropertyType previous = township.getPropertyType();
        township.setPropertyType(request.propertyType());
        townships.save(township);
        audit.record(AuditAction.PROPERTY_TYPE_CHANGED, "township", townshipId,
                AuditService.detail("from", previous, "to", request.propertyType()));

        if (request.resetLevels()) {
            return defineLevels(new DefineLevelsRequest(request.propertyType().levels().stream()
                    .map(p -> new LevelSpec(p.kind(), p.singular(), p.plural()))
                    .toList()));
        }
        return profile();
    }

    /**
     * Seeds a brand-new township's levels from its type's preset. Called at township creation, so
     * an admin never meets an empty structure screen with no way to know what to put in it.
     *
     * <p>Not {@code @PreAuthorize}d and not tenant-scoped: it takes the township explicitly
     * because it runs during provisioning, before that township is anyone's acting tenant.
     */
    @Transactional
    public void seedLevelsFor(Township township, PropertyType type) {
        seedLevelsFor(township, type.levels().stream()
                .map(preset -> new LevelSpec(preset.kind(), preset.singular(), preset.plural()))
                .toList());
    }

    /**
     * Seeds an explicit level set, for a super admin who described the developer's structure at
     * onboarding rather than picking a preset. Validated through exactly the same rules as
     * {@link #defineLevels}, so a structure that could not be set later cannot be set here either.
     *
     * <p>Not {@code @PreAuthorize}d and not tenant-scoped, for the same reason as its sibling: it
     * runs during provisioning, before the township it is building is anyone's acting tenant.
     */
    @Transactional
    public void seedLevelsFor(Township township, List<LevelSpec> specs) {
        if (levels.countByTownship_Id(township.getId()) > 0) {
            return;
        }
        validateLevelShape(specs);
        for (int depth = 0; depth < specs.size(); depth++) {
            LevelSpec spec = specs.get(depth);
            PropertyLevel level = new PropertyLevel();
            level.setTownship(township);
            level.setDepth(depth);
            level.setKind(spec.kind());
            level.setSingular(spec.singular().trim());
            level.setPlural(spec.plural().trim());
            levels.save(level);
        }
    }

    /**
     * A level set must be a plausible hierarchy, not any sequence of kinds. The rules encode what
     * the tree means rather than taste: exactly one addressable level (or "which one is the unit?"
     * has no answer), it must be last (nothing lives inside a home), and a floor must sit inside
     * something physical (a storey of a phase is not a thing).
     */
    public void validateLevelShape(List<LevelSpec> specs) {
        long unitCount = specs.stream().filter(s -> s.kind() == PropertyNodeKind.UNIT).count();
        if (unitCount != 1) {
            throw new BusinessValidationException("UNIT_LEVEL_REQUIRED",
                    "Exactly one level must be the addressable unit level; got " + unitCount + ".");
        }
        if (specs.get(specs.size() - 1).kind() != PropertyNodeKind.UNIT) {
            throw new BusinessValidationException("UNIT_LEVEL_MUST_BE_LAST",
                    "The unit level must be the deepest level -- nothing is filed inside a unit.");
        }
        for (int i = 0; i < specs.size(); i++) {
            if (specs.get(i).kind() == PropertyNodeKind.FLOOR) {
                if (i == 0 || specs.get(i - 1).kind() != PropertyNodeKind.BUILDING) {
                    throw new BusinessValidationException("FLOOR_NEEDS_BUILDING",
                            "A floor level must sit directly inside a building level.");
                }
            }
        }
    }

    /**
     * The project-type catalogue. Static reference data derived from {@link PropertyType}, with no
     * authorization or tenant scoping of its own -- it describes the product's presets, not any
     * township's data, and it has to be readable by a super admin who has not created the township
     * yet. Both {@code /admin/property/types} and {@code /super/property-types} return this.
     */
    public List<PropertyTypeOption> catalogue() {
        return java.util.Arrays.stream(PropertyType.values())
                .map(type -> new PropertyTypeOption(
                        type,
                        type.displayName(),
                        type.category().name(),
                        type.category().label(),
                        type.description(),
                        type.hasFloors(),
                        type.levels().stream()
                                .map(l -> new LevelSpec(l.kind(), l.singular(), l.plural()))
                                .toList()))
                .toList();
    }

    // ----- nodes --------------------------------------------------------------------------------

    /** Guards need the structure to route a walk-in; residents do not need a township directory. */
    @PreAuthorize("hasAnyRole('ADMIN','GUARD')")
    @Transactional(readOnly = true)
    public List<PropertyNodeResponse> listNodes(UUID parentId, Integer depth) {
        UUID townshipId = TenantContext.requireTownshipId();
        List<PropertyNode> result;
        if (parentId != null) {
            // Resolve the parent within the tenant first, so an id from another township is a 404
            // rather than a listing of that township's structure.
            requireNode(parentId);
            result = nodes.findChildrenOrdered(parentId);
        } else if (depth != null) {
            result = nodes.findByTownship_IdAndDepthOrderByNameAsc(townshipId, depth);
        } else {
            result = nodes.findByTownship_IdOrderByDepthAscNameAsc(townshipId);
        }
        // Container names are resolved against one preloaded map of the township's non-unit nodes
        // rather than by walking each node's lazy parent chain: a listing of 500 flats would
        // otherwise be 500 extra queries, and there are only ever a handful of towers and floors.
        Map<UUID, PropertyNode> ancestors = loadAncestors(townshipId);
        return result.stream().map(node -> toResponse(node, ancestors)).toList();
    }

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public PropertyNodeResponse createNode(CreateNodeRequest request) {
        PropertyNode node = insertNode(request);
        audit.record(AuditAction.PROPERTY_NODE_CREATED, "property_node", node.getId(),
                AuditService.detail("kind", node.getKind(), "name", node.getName(),
                        "code", node.getCode(), "parentId", node.getParentId()));
        return toResponse(node);
    }

    /** The shared insert path, so bulk creation obeys exactly the rules single creation does. */
    private PropertyNode insertNode(CreateNodeRequest request) {
        UUID townshipId = TenantContext.requireTownshipId();
        PropertyNode parent = request.parentId() == null ? null : requireNode(request.parentId());

        if (parent != null && !parent.getKind().canHaveChildren()) {
            throw new ConflictException("UNIT_IS_A_LEAF",
                    "Nothing can be filed inside a unit.");
        }
        int depth = parent == null ? 0 : parent.getDepth() + 1;
        PropertyLevel level = levels.findByTownship_IdAndDepth(townshipId, depth)
                .orElseThrow(() -> new BusinessValidationException("LEVEL_NOT_DEFINED",
                        "This township has no level defined at depth " + depth
                                + ". Define the levels before adding structure at it."));
        PropertyNodeKind kind = level.getKind();

        String name = request.name().trim();
        boolean duplicateName = parent == null
                ? nodes.existsByTownship_IdAndParentIsNullAndNameIgnoreCase(townshipId, name)
                : nodes.existsByParent_IdAndNameIgnoreCase(parent.getId(), name);
        if (duplicateName) {
            throw new ConflictException("NODE_NAME_EXISTS",
                    "A " + level.getSingular().toLowerCase() + " called \"" + name
                            + "\" already exists here.");
        }

        String code = normaliseCode(request.code(), kind, name, townshipId, level);
        Integer levelNumber = normaliseLevelNumber(request.levelNumber(), kind, parent, level);
        int occupancy = request.declaredOccupancy() == null ? 0 : request.declaredOccupancy();
        if (occupancy > 0 && !kind.isUnit()) {
            throw new BusinessValidationException("OCCUPANCY_NOT_A_UNIT",
                    "Only a " + unitLevelLabel(townshipId) + " can have an occupancy.");
        }

        PropertyNode node = new PropertyNode();
        // Township comes from the parent, not the context, so a child can only ever land in the
        // same township as its parent -- which property_node_parent_same_township also enforces.
        node.setTownship(parent == null ? currentTownship() : parent.getTownship());
        node.setParent(parent);
        node.setKind(kind);
        node.setName(name);
        node.setCode(code);
        node.setLevelNumber(levelNumber);
        node.setDeclaredOccupancy(occupancy);
        // depth, path and is_unit are filled in by the database trigger, so the in-memory entity
        // is stale the moment it is written. Flush then refresh, or the response would report
        // depth 0 and an empty path for every node.
        nodes.saveAndFlush(node);
        entityManager.refresh(node);
        return node;
    }

    private String normaliseCode(String raw, PropertyNodeKind kind, String name, UUID townshipId,
                                 PropertyLevel level) {
        if (!kind.isUnit()) {
            if (raw != null && !raw.isBlank()) {
                throw new BusinessValidationException("CODE_NOT_A_UNIT",
                        "Only a " + level.getSingular().toLowerCase() + " at the unit level has a code.");
            }
            return null;
        }
        // A unit's code defaults to its name: the overwhelmingly common case is that they are the
        // same string ("A-1401"), and making an admin type it twice invites them to disagree.
        String code = (raw == null || raw.isBlank()) ? name : raw.trim();
        if (nodes.existsByTownship_IdAndCodeIgnoreCase(townshipId, code)) {
            throw new ConflictException("UNIT_CODE_EXISTS",
                    "A unit with the code \"" + code + "\" already exists in this township. Codes are "
                            + "unique township-wide because resident login ids are derived from them.");
        }
        return code;
    }

    private Integer normaliseLevelNumber(Integer raw, PropertyNodeKind kind, PropertyNode parent,
                                         PropertyLevel level) {
        if (!kind.carriesStoreyNumber()) {
            if (raw != null) {
                throw new BusinessValidationException("STOREY_NOT_A_FLOOR",
                        "Only a " + level.getSingular().toLowerCase() + " at a floor level has a storey number.");
            }
            return null;
        }
        if (raw == null) {
            throw new BusinessValidationException("STOREY_REQUIRED",
                    "A storey number is required so floors sort correctly -- use 0 for ground.");
        }
        if (parent != null && nodes.existsByParent_IdAndLevelNumber(parent.getId(), raw)) {
            throw new ConflictException("STOREY_EXISTS",
                    "Storey " + raw + " already exists in " + parent.getName() + ".");
        }
        return raw;
    }

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public PropertyNodeResponse updateNode(UUID nodeId, UpdateNodeRequest request) {
        UUID townshipId = TenantContext.requireTownshipId();
        PropertyNode node = requireNode(nodeId);
        String name = request.name().trim();

        boolean renaming = !name.equalsIgnoreCase(node.getName());
        if (renaming) {
            boolean clash = node.getParentId() == null
                    ? nodes.existsByTownship_IdAndParentIsNullAndNameIgnoreCase(townshipId, name)
                    : nodes.existsByParent_IdAndNameIgnoreCase(node.getParentId(), name);
            if (clash) {
                throw new ConflictException("NODE_NAME_EXISTS",
                        "Something called \"" + name + "\" already exists here.");
            }
        }
        node.setName(name);

        if (node.getKind().isUnit()) {
            String code = (request.code() == null || request.code().isBlank())
                    ? name : request.code().trim();
            if (!code.equalsIgnoreCase(node.getCode())
                    && nodes.existsByTownship_IdAndCodeIgnoreCase(townshipId, code)) {
                throw new ConflictException("UNIT_CODE_EXISTS",
                        "A unit with the code \"" + code + "\" already exists in this township.");
            }
            node.setCode(code);
        } else if (request.code() != null && !request.code().isBlank()) {
            throw new BusinessValidationException("CODE_NOT_A_UNIT",
                    "Only a unit has a code.");
        }

        if (node.getKind().carriesStoreyNumber() && request.levelNumber() != null
                && !request.levelNumber().equals(node.getLevelNumber())) {
            if (nodes.existsByParent_IdAndLevelNumber(node.getParentId(), request.levelNumber())) {
                throw new ConflictException("STOREY_EXISTS",
                        "Storey " + request.levelNumber() + " already exists here.");
            }
            node.setLevelNumber(request.levelNumber());
        }

        nodes.save(node);
        audit.record(AuditAction.PROPERTY_NODE_UPDATED, "property_node", nodeId,
                AuditService.detail("name", node.getName(), "code", node.getCode()));
        return toResponse(node);
    }

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public void deleteNode(UUID nodeId) {
        PropertyNode node = requireNode(nodeId);
        if (nodes.countByParent_Id(nodeId) > 0) {
            throw new ConflictException("NODE_NOT_EMPTY",
                    "Remove everything inside \"" + node.getName() + "\" before deleting it.");
        }
        if (node.getKind().isUnit() && users.countByUnit_Id(nodeId) > 0) {
            throw new ConflictException("UNIT_OCCUPIED",
                    "Deactivate the resident accounts on this unit before deleting it.");
        }
        nodes.delete(node);
        audit.record(AuditAction.PROPERTY_NODE_DELETED, "property_node", nodeId,
                AuditService.detail("kind", node.getKind(), "name", node.getName()));
    }

    // ----- bulk creation --------------------------------------------------------------------------

    /**
     * Generates a building's worth of structure in one transaction: the floors, and the units on
     * each. Creating a 20-storey tower four units at a time is 80 round trips, which is why a bulk
     * flat creator existed before the tree and why it has to keep existing after it.
     *
     * <p>Everything goes through {@link #insertNode}, so bulk creation cannot produce a node that a
     * single creation would have refused -- the duplicate-code check, the storey check and the
     * level lookup all apply per node. All of it in one transaction: a partially generated tower
     * with an unknown number of units in it is worse than no tower, because the admin's only
     * recovery is to work out which half exists.
     *
     * <p>Whether the township has a floor level is read from the level definitions, not from the
     * request -- a villa community has no floors to generate, and asking the caller to know that
     * invites a request that says otherwise.
     */
    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public BulkCreateResponse bulkCreate(BulkCreateRequest request) {
        UUID townshipId = TenantContext.requireTownshipId();
        PropertyNode building = requireNode(request.buildingId());
        if (!building.getKind().canHaveChildren()) {
            throw new ConflictException("UNIT_IS_A_LEAF", "Nothing can be filed inside a unit.");
        }

        PropertyLevel childLevel = levels.findByTownship_IdAndDepth(townshipId, building.getDepth() + 1)
                .orElseThrow(() -> new BusinessValidationException("LEVEL_NOT_DEFINED",
                        "This township has no level below \"" + building.getName() + "\"."));
        boolean generatingFloors = childLevel.getKind() == PropertyNodeKind.FLOOR;

        int from = request.fromFloor() == null ? 1 : request.fromFloor();
        int to = request.toFloor() == null ? from : request.toFloor();
        if (generatingFloors) {
            if (request.fromFloor() == null || request.toFloor() == null) {
                throw new BusinessValidationException("FLOOR_RANGE_REQUIRED",
                        "This township has a floor level, so fromFloor and toFloor are required.");
            }
            if (to < from) {
                throw new BusinessValidationException("FLOOR_RANGE_INVALID",
                        "toFloor must not be below fromFloor.");
            }
        } else if (request.fromFloor() != null || request.toFloor() != null) {
            throw new BusinessValidationException("NO_FLOOR_LEVEL",
                    "This township has no floor level, so a floor range cannot be generated. Its "
                            + childLevel.getPlural().toLowerCase() + " hang directly off \""
                            + building.getName() + "\".");
        }

        int digits = request.unitDigits() == null ? 2 : request.unitDigits();
        List<String> codes = new ArrayList<>();
        int floorsCreated = 0;

        // A single flat range when there are no floors; one pass per storey when there are.
        int storeys = generatingFloors ? (to - from + 1) : 1;
        for (int i = 0; i < storeys; i++) {
            Integer storey = generatingFloors ? from + i : null;
            UUID unitParentId = building.getId();

            if (generatingFloors) {
                PropertyNode floor = insertNode(new CreateNodeRequest(
                        building.getId(), floorName(storey), null, storey, null));
                unitParentId = floor.getId();
                floorsCreated++;
            }
            for (int u = 1; u <= request.unitsPerFloor(); u++) {
                String code = expand(request.codePattern(), building.getName(), storey, u, digits);
                insertNode(new CreateNodeRequest(unitParentId, code, code, null, null));
                codes.add(code);
            }
        }

        audit.record(AuditAction.PROPERTY_NODE_CREATED, "property_node", building.getId(),
                AuditService.detail("bulk", true, "floors", floorsCreated, "units", codes.size()));
        return new BulkCreateResponse(floorsCreated, codes.size(), codes);
    }

    /** Storey 0 is the ground floor everywhere this product ships; below it is a basement. */
    private String floorName(Integer storey) {
        if (storey == null) {
            return "";
        }
        if (storey == 0) {
            return "Ground";
        }
        return storey < 0 ? "Basement " + Math.abs(storey) : String.valueOf(storey);
    }

    /**
     * Expands a code pattern. Only the three placeholders are substituted and everything else is
     * copied verbatim, so a pattern is a template rather than anything evaluated.
     */
    private String expand(String pattern, String buildingName, Integer storey, int unit, int digits) {
        String unitPart = String.format("%0" + digits + "d", unit);
        return pattern
                .replace("{building}", buildingName)
                .replace("{floor}", storey == null ? "" : String.valueOf(storey))
                .replace("{unit}", unitPart)
                .trim();
    }

    // ----- occupancy ------------------------------------------------------------------------------

    /**
     * Sets how many people live in a unit.
     *
     * <p>The floor is the number of active resident accounts already attached: an admin cannot
     * declare that two people live somewhere the system has already issued four logins for. That
     * invariant spans {@code property_node} and {@code app_user}, so it cannot be a check
     * constraint -- but the counterpart in {@code UserProvisioningService} raises the declared
     * figure automatically when a new resident is added, so the two can only disagree in the
     * direction of the declaration being higher, which is exactly the case that is legitimate
     * (family members with no login).
     */
    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public PropertyNodeResponse setDeclaredOccupancy(UUID nodeId, SetOccupancyRequest request) {
        PropertyNode node = requireNode(nodeId);
        if (!node.getKind().isUnit()) {
            throw new BusinessValidationException("OCCUPANCY_NOT_A_UNIT",
                    "Occupancy is recorded on units, not on \"" + node.getName() + "\". A building's "
                            + "occupancy is the sum of the units inside it.");
        }
        long accounts = users.countByUnit_IdAndRoleAndActiveTrue(nodeId, UserRole.RESIDENT);
        if (request.declaredOccupancy() < accounts) {
            throw new ConflictException("OCCUPANCY_BELOW_RESIDENTS",
                    "This unit already has " + accounts + " active resident account(s); declared "
                            + "occupancy cannot be lower. Deactivate the accounts first.");
        }
        int previous = node.getDeclaredOccupancy();
        node.setDeclaredOccupancy(request.declaredOccupancy());
        nodes.save(node);
        audit.record(AuditAction.OCCUPANCY_CHANGED, "property_node", nodeId,
                AuditService.detail("from", previous, "to", request.declaredOccupancy(),
                        "unit", node.getCode()));
        return toResponse(node);
    }

    /**
     * Raises a unit's declared occupancy to at least {@code atLeast}, without an authorization
     * check of its own -- it is called from within {@code UserProvisioningService}, which has
     * already established the caller may provision into this unit.
     *
     * <p>This is what keeps the two numbers consistent: provisioning a fourth resident into a unit
     * declared as holding two silently used to leave the declaration wrong, and nothing ever
     * corrected it.
     */
    @Transactional
    public void raiseDeclaredOccupancy(PropertyNode unit, long atLeast) {
        if (unit.getDeclaredOccupancy() >= atLeast) {
            return;
        }
        int previous = unit.getDeclaredOccupancy();
        unit.setDeclaredOccupancy((int) atLeast);
        nodes.save(unit);
        audit.record(AuditAction.OCCUPANCY_CHANGED, "property_node", unit.getId(),
                AuditService.detail("from", previous, "to", atLeast, "reason", "RESIDENT_PROVISIONED"));
    }

    // ----- lookups used by other services ----------------------------------------------------------

    @Transactional(readOnly = true)
    public Township currentTownship() {
        return townships.getReferenceById(TenantContext.requireTownshipId());
    }

    @Transactional(readOnly = true)
    public PropertyNode requireNode(UUID nodeId) {
        return nodes.findByIdAndTownship_Id(nodeId, TenantContext.requireTownshipId())
                .orElseThrow(() -> NotFoundException.of("Property node", nodeId));
    }

    /**
     * Resolves a node and insists it is the addressable unit level. Callers that mean "the place a
     * resident lives" or "where this visitor is going" must use this rather than
     * {@link #requireNode}: the database refuses a resident attached to a tower, but a 400 naming
     * the problem beats a foreign key violation surfacing as a 500.
     */
    @Transactional(readOnly = true)
    public PropertyNode requireUnit(UUID nodeId) {
        PropertyNode node = requireNode(nodeId);
        if (!node.getKind().isUnit()) {
            throw new BusinessValidationException("NOT_A_UNIT",
                    "\"" + node.getName() + "\" is not a unit -- residents and visits attach to the "
                            + "unit level only.");
        }
        return node;
    }

    private String unitLevelLabel(UUID townshipId) {
        return levels.findByTownship_IdAndKind(townshipId, PropertyNodeKind.UNIT)
                .map(l -> l.getSingular().toLowerCase())
                .orElse("unit");
    }

    private String requireLabel(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new BusinessValidationException("LABEL_REQUIRED", field + " must not be blank.");
        }
        String trimmed = value.trim();
        if (trimmed.length() > 40) {
            throw new BusinessValidationException("LABEL_TOO_LONG",
                    field + " must be at most 40 characters.");
        }
        return trimmed;
    }

    /** Every node that could be somebody's ancestor: the tree minus its leaves. */
    private Map<UUID, PropertyNode> loadAncestors(UUID townshipId) {
        return nodes.findByTownship_IdOrderByDepthAscNameAsc(townshipId).stream()
                .filter(n -> !n.getKind().isUnit())
                .collect(Collectors.toMap(PropertyNode::getId, n -> n));
    }

    /**
     * Walks up to the nearest node that is not a floor, using the preloaded map so no lazy proxy is
     * touched. Mirrors {@link PropertyNode#containerName()}, which is the single-node equivalent
     * used where only one row is in hand.
     */
    private String containerName(PropertyNode node, Map<UUID, PropertyNode> ancestors) {
        UUID parentId = node.getParentId();
        while (parentId != null) {
            PropertyNode ancestor = ancestors.get(parentId);
            if (ancestor == null) {
                return null;
            }
            if (ancestor.getKind() != PropertyNodeKind.FLOOR) {
                return ancestor.getName();
            }
            parentId = ancestor.getParentId();
        }
        return null;
    }

    PropertyNodeResponse toResponse(PropertyNode node) {
        return toResponse(node, loadAncestors(node.getTownshipId()));
    }

    PropertyNodeResponse toResponse(PropertyNode node, Map<UUID, PropertyNode> ancestors) {
        return new PropertyNodeResponse(
                node.getId(),
                node.getParentId(),
                node.getDepth(),
                node.getKind(),
                node.getName(),
                node.getCode(),
                node.getLevelNumber(),
                containerName(node, ancestors),
                node.getDeclaredOccupancy(),
                node.getKind().isUnit() ? users.countByUnit_IdAndRoleAndActiveTrue(node.getId(), UserRole.RESIDENT) : 0L,
                nodes.countByParent_Id(node.getId()),
                node.getCreatedAt());
    }
}
