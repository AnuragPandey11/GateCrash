package com.gatecrash.township;

import com.gatecrash.common.audit.AuditAction;
import com.gatecrash.common.audit.AuditService;
import com.gatecrash.common.exception.ConflictException;
import com.gatecrash.common.exception.NotFoundException;
import com.gatecrash.common.tenant.TenantContext;
import com.gatecrash.township.dto.TownshipDtos.BlockResponse;
import com.gatecrash.township.dto.TownshipDtos.CreateBlockRequest;
import com.gatecrash.township.dto.TownshipDtos.CreateFlatRequest;
import com.gatecrash.township.dto.TownshipDtos.CreateGateRequest;
import com.gatecrash.township.dto.TownshipDtos.FlatResponse;
import com.gatecrash.township.dto.TownshipDtos.GateResponse;
import com.gatecrash.user.AppUserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

/**
 * Township structure: blocks, flats and gates -- always those of {@link TenantContext}'s township.
 *
 * <p>Every read and every write in here is anchored on the current tenant, and the point lookups
 * ({@link #requireGate}, {@link #requireFlat}) resolve by {@code (id, townshipId)} rather than by id
 * alone. That is not belt-and-braces: a gate id is a UUID in a request body, and finding the row it
 * names is a different question from being entitled to it. Resolving the pair means a caller from
 * another township gets a 404 -- the same answer they would get for an id that does not exist, which
 * is the answer that tells them nothing.
 *
 * <p>Deletion is only ever allowed while nothing references the row. Blocks, flats and gates are
 * pointed at by residents and by every historical visitor log, so a cascading delete would tear holes
 * in the access-control record. Structures that are genuinely retired stay in place.
 */
@Service
@RequiredArgsConstructor
public class TownshipService {

    private final TownshipRepository townships;
    private final BuildingBlockRepository blocks;
    private final FlatRepository flats;
    private final GateRepository gates;
    private final AppUserRepository users;
    private final AuditService audit;

    // ----- blocks -----------------------------------------------------------------------------

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public BlockResponse createBlock(CreateBlockRequest request) {
        UUID townshipId = TenantContext.requireTownshipId();
        String name = request.name().trim();
        if (blocks.existsByTownship_IdAndNameIgnoreCase(townshipId, name)) {
            throw new ConflictException("BLOCK_EXISTS", "A block with that name already exists.");
        }
        BuildingBlock block = new BuildingBlock();
        block.setTownship(currentTownship());
        block.setName(name);
        blocks.save(block);
        audit.record(AuditAction.BLOCK_CREATED, "building_block", block.getId(),
                AuditService.detail("name", name));
        return toResponse(block, 0);
    }

    @PreAuthorize("hasAnyRole('ADMIN','GUARD')")
    @Transactional(readOnly = true)
    public List<BlockResponse> listBlocks() {
        return blocks.findByTownship_IdOrderByNameAsc(TenantContext.requireTownshipId()).stream()
                .map(block -> toResponse(block, flats.countByBlock_Id(block.getId())))
                .toList();
    }

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public void deleteBlock(UUID blockId) {
        BuildingBlock block = requireBlock(blockId);
        if (flats.countByBlock_Id(blockId) > 0) {
            throw new ConflictException("BLOCK_NOT_EMPTY",
                    "Remove the flats in this block before deleting it.");
        }
        blocks.delete(block);
        audit.record(AuditAction.BLOCK_DELETED, "building_block", blockId, null);
    }

    // ----- flats ------------------------------------------------------------------------------

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public FlatResponse createFlat(CreateFlatRequest request) {
        BuildingBlock block = requireBlock(request.blockId());
        String number = request.number().trim();
        if (flats.existsByBlock_IdAndNumberIgnoreCase(block.getId(), number)) {
            throw new ConflictException("FLAT_EXISTS", "That flat number already exists in this block.");
        }
        Flat flat = new Flat();
        // Taken from the block, not from the context, so the flat can only ever land in the same
        // township as its parent -- which the flat_block_same_township foreign key also enforces.
        flat.setTownship(block.getTownship());
        flat.setBlock(block);
        flat.setNumber(number);
        flats.save(flat);
        audit.record(AuditAction.FLAT_CREATED, "flat", flat.getId(),
                AuditService.detail("number", number, "blockId", block.getId()));
        return toResponse(flat);
    }

    /** Guards need the flat list to route a walk-in; residents do not need a township directory. */
    @PreAuthorize("hasAnyRole('ADMIN','GUARD')")
    @Transactional(readOnly = true)
    public List<FlatResponse> listFlats(UUID blockId) {
        UUID townshipId = TenantContext.requireTownshipId();
        List<Flat> result;
        if (blockId == null) {
            result = flats.findByTownship_IdOrderByNumberAsc(townshipId);
        } else {
            // Resolve the block within the tenant first, so a block id from another township is a
            // 404 rather than a listing of that township's flats.
            requireBlock(blockId);
            result = flats.findByBlock_IdOrderByNumberAsc(blockId);
        }
        return result.stream().map(this::toResponse).toList();
    }

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public void deleteFlat(UUID flatId) {
        Flat flat = requireFlat(flatId);
        if (users.countByFlat_Id(flatId) > 0) {
            throw new ConflictException("FLAT_OCCUPIED",
                    "Deactivate the resident accounts on this flat before deleting it.");
        }
        flats.delete(flat);
        audit.record(AuditAction.FLAT_DELETED, "flat", flatId, null);
    }

    // ----- gates ------------------------------------------------------------------------------

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public GateResponse createGate(CreateGateRequest request) {
        UUID townshipId = TenantContext.requireTownshipId();
        String name = request.name().trim();
        if (gates.existsByTownship_IdAndNameIgnoreCase(townshipId, name)) {
            throw new ConflictException("GATE_EXISTS", "A gate with that name already exists.");
        }
        Gate gate = new Gate();
        gate.setTownship(currentTownship());
        gate.setName(name);
        gates.save(gate);
        audit.record(AuditAction.GATE_CREATED, "gate", gate.getId(), AuditService.detail("name", name));
        return toResponse(gate);
    }

    @PreAuthorize("hasAnyRole('ADMIN','GUARD')")
    @Transactional(readOnly = true)
    public List<GateResponse> listGates() {
        return gates.findByTownship_IdOrderByNameAsc(TenantContext.requireTownshipId()).stream()
                .map(this::toResponse)
                .toList();
    }

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public void deleteGate(UUID gateId) {
        Gate gate = requireGate(gateId);
        gates.delete(gate);
        audit.record(AuditAction.GATE_DELETED, "gate", gateId, null);
    }

    // ----- internal lookups used by other services --------------------------------------------

    /**
     * A managed reference to the current tenant, for stamping onto a row being created. A reference
     * rather than a fetch: the row only needs the foreign key, and the township itself was already
     * validated by {@code TenantContextFilter} before the request reached any service.
     */
    @Transactional(readOnly = true)
    public Township currentTownship() {
        return townships.getReferenceById(TenantContext.requireTownshipId());
    }

    @Transactional(readOnly = true)
    public Gate requireGate(UUID gateId) {
        return gates.findByIdAndTownship_Id(gateId, TenantContext.requireTownshipId())
                .orElseThrow(() -> NotFoundException.of("Gate", gateId));
    }

    @Transactional(readOnly = true)
    public Flat requireFlat(UUID flatId) {
        return flats.findByIdAndTownship_Id(flatId, TenantContext.requireTownshipId())
                .orElseThrow(() -> NotFoundException.of("Flat", flatId));
    }

    @Transactional(readOnly = true)
    public BuildingBlock requireBlock(UUID blockId) {
        return blocks.findByIdAndTownship_Id(blockId, TenantContext.requireTownshipId())
                .orElseThrow(() -> NotFoundException.of("Block", blockId));
    }

    private BlockResponse toResponse(BuildingBlock block, long flatCount) {
        return new BlockResponse(block.getId(), block.getName(), flatCount, block.getCreatedAt());
    }

    private FlatResponse toResponse(Flat flat) {
        return new FlatResponse(flat.getId(), flat.getNumber(), flat.getBlock().getId(),
                flat.getBlock().getName(), flat.getCreatedAt());
    }

    private GateResponse toResponse(Gate gate) {
        return new GateResponse(gate.getId(), gate.getName(), gate.getCreatedAt());
    }
}
