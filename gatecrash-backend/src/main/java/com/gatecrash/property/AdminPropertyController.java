package com.gatecrash.property;

import com.gatecrash.property.dto.PropertyDtos.BulkCreateRequest;
import com.gatecrash.property.dto.PropertyDtos.BulkCreateResponse;
import com.gatecrash.property.dto.PropertyDtos.CreateNodeRequest;
import com.gatecrash.property.dto.PropertyDtos.DefineLevelsRequest;
import com.gatecrash.property.dto.PropertyDtos.OccupancySummaryResponse;
import com.gatecrash.property.dto.PropertyDtos.PropertyNodeResponse;
import com.gatecrash.property.dto.PropertyDtos.PropertyProfileResponse;
import com.gatecrash.property.dto.PropertyDtos.PropertyTypeOption;
import com.gatecrash.property.dto.PropertyDtos.SetOccupancyRequest;
import com.gatecrash.property.dto.PropertyDtos.SetPropertyTypeRequest;
import com.gatecrash.property.dto.PropertyDtos.UpdateNodeRequest;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * The township's property hierarchy, whatever shape its developer actually builds.
 *
 * <p>Replaces the fixed {@code /blocks} and {@code /flats} pair. Those endpoints assumed every
 * project was blocks of flats; a villa community and a plotted layout had to pretend to be one.
 *
 * <p>Thin, per the layering rule: every authorization check and every business rule is on the
 * service methods, not here.
 */
@RestController
@RequestMapping("/api/v1/admin/property")
@RequiredArgsConstructor
@Tag(name = "Admin - Property")
public class AdminPropertyController {

    private final PropertyService property;
    private final OccupancyService occupancy;

    // ----- profile and levels ------------------------------------------------------------------

    /**
     * The whole shape of this township in one call: its project type and its ordered, labelled
     * levels. The console renders its structure tabs from this rather than from hardcoded strings,
     * which is what makes the panel adapt per developer.
     */
    @GetMapping("/profile")
    @Operation(summary = "This township's project type and level definitions")
    public PropertyProfileResponse profile() {
        return property.profile();
    }

    /** The presets available when onboarding or reshaping a township. Static reference data. */
    @GetMapping("/types")
    @Operation(summary = "Available project types and their default level sets")
    public List<PropertyTypeOption> types() {
        return property.catalogue();
    }

    @PutMapping("/levels")
    @Operation(summary = "Replace the level set (only while the township has no structure)")
    public PropertyProfileResponse defineLevels(@Valid @RequestBody DefineLevelsRequest request) {
        return property.defineLevels(request);
    }

    /** Renaming stays available after the tree is populated; reshaping does not. */
    @PatchMapping("/levels/{id}")
    @Operation(summary = "Rename one level")
    public PropertyProfileResponse renameLevel(@PathVariable UUID id,
                                               @Valid @RequestBody RenameLevelRequest request) {
        return property.renameLevel(id, request.singular(), request.plural());
    }

    public record RenameLevelRequest(
            @NotBlank @Size(max = 40) String singular,
            @NotBlank @Size(max = 40) String plural) {
    }

    @PutMapping("/type")
    @Operation(summary = "Change the project type, optionally re-seeding the level labels")
    public PropertyProfileResponse setType(@Valid @RequestBody SetPropertyTypeRequest request) {
        return property.setPropertyType(request);
    }

    // ----- nodes -------------------------------------------------------------------------------

    /**
     * Lists by parent for drilling into the tree, by depth for a whole level at once ("every unit"),
     * or everything when neither is given.
     */
    @GetMapping("/nodes")
    @Operation(summary = "List nodes by parent, by depth, or all")
    public List<PropertyNodeResponse> listNodes(@RequestParam(required = false) UUID parentId,
                                                @RequestParam(required = false) Integer depth) {
        return property.listNodes(parentId, depth);
    }

    @PostMapping("/nodes")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Create a node; its kind comes from the level it lands at")
    public PropertyNodeResponse createNode(@Valid @RequestBody CreateNodeRequest request) {
        return property.createNode(request);
    }

    @PatchMapping("/nodes/{id}")
    @Operation(summary = "Rename a node or change its code / storey number")
    public PropertyNodeResponse updateNode(@PathVariable UUID id,
                                           @Valid @RequestBody UpdateNodeRequest request) {
        return property.updateNode(id, request);
    }

    @DeleteMapping("/nodes/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Delete an empty node")
    public void deleteNode(@PathVariable UUID id) {
        property.deleteNode(id);
    }

    @PostMapping("/nodes/bulk")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Generate a building's floors and units in one call")
    public BulkCreateResponse bulkCreate(@Valid @RequestBody BulkCreateRequest request) {
        return property.bulkCreate(request);
    }

    // ----- occupancy ----------------------------------------------------------------------------

    /**
     * Sets how many people live in a unit, including those with no app account. Refused below the
     * number of active resident accounts already on the unit.
     */
    @PutMapping("/nodes/{id}/occupancy")
    @Operation(summary = "Set a unit's declared occupancy")
    public PropertyNodeResponse setOccupancy(@PathVariable UUID id,
                                             @Valid @RequestBody SetOccupancyRequest request) {
        return property.setDeclaredOccupancy(id, request);
    }

    /**
     * Unit occupancy, resident headcount and visitors on site, reported separately.
     *
     * <p>Distinct from {@code GET /admin/inside}, which is the live gate roll and stays where it is:
     * that one is the guard's screen, this one is the developer's.
     */
    @GetMapping("/occupancy")
    @Operation(summary = "Occupancy summary: units, residents and visitors on site")
    public OccupancySummaryResponse occupancy() {
        return occupancy.summary();
    }
}
