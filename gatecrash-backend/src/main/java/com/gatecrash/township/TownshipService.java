package com.gatecrash.township;

import com.gatecrash.common.audit.AuditAction;
import com.gatecrash.common.audit.AuditService;
import com.gatecrash.common.exception.ConflictException;
import com.gatecrash.common.exception.NotFoundException;
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
 * Township structure: blocks, flats and gates.
 *
 * <p>Deletion is only ever allowed while nothing references the row. Blocks, flats and gates are
 * pointed at by residents and by every historical visitor log, so a cascading delete would tear holes
 * in the access-control record. Structures that are genuinely retired stay in place.
 */
@Service
@RequiredArgsConstructor
public class TownshipService {

    private final BuildingBlockRepository blocks;
    private final FlatRepository flats;
    private final GateRepository gates;
    private final AppUserRepository users;
    private final AuditService audit;

    // ----- blocks -----------------------------------------------------------------------------

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public BlockResponse createBlock(CreateBlockRequest request) {
        String name = request.name().trim();
        if (blocks.existsByNameIgnoreCase(name)) {
            throw new ConflictException("BLOCK_EXISTS", "A block with that name already exists.");
        }
        BuildingBlock block = new BuildingBlock();
        block.setName(name);
        blocks.save(block);
        audit.record(AuditAction.BLOCK_CREATED, "building_block", block.getId(),
                AuditService.detail("name", name));
        return toResponse(block, 0);
    }

    @PreAuthorize("hasAnyRole('ADMIN','GUARD')")
    @Transactional(readOnly = true)
    public List<BlockResponse> listBlocks() {
        return blocks.findAllByOrderByNameAsc().stream()
                .map(block -> toResponse(block, flats.countByBlock_Id(block.getId())))
                .toList();
    }

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public void deleteBlock(UUID blockId) {
        BuildingBlock block = blocks.findById(blockId)
                .orElseThrow(() -> NotFoundException.of("Block", blockId));
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
        BuildingBlock block = blocks.findById(request.blockId())
                .orElseThrow(() -> NotFoundException.of("Block", request.blockId()));
        String number = request.number().trim();
        if (flats.existsByBlock_IdAndNumberIgnoreCase(block.getId(), number)) {
            throw new ConflictException("FLAT_EXISTS", "That flat number already exists in this block.");
        }
        Flat flat = new Flat();
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
        List<Flat> result = blockId == null
                ? flats.findAllByOrderByNumberAsc()
                : flats.findByBlock_IdOrderByNumberAsc(blockId);
        return result.stream().map(this::toResponse).toList();
    }

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public void deleteFlat(UUID flatId) {
        Flat flat = flats.findById(flatId)
                .orElseThrow(() -> NotFoundException.of("Flat", flatId));
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
        String name = request.name().trim();
        if (gates.existsByNameIgnoreCase(name)) {
            throw new ConflictException("GATE_EXISTS", "A gate with that name already exists.");
        }
        Gate gate = new Gate();
        gate.setName(name);
        gates.save(gate);
        audit.record(AuditAction.GATE_CREATED, "gate", gate.getId(), AuditService.detail("name", name));
        return toResponse(gate);
    }

    @PreAuthorize("hasAnyRole('ADMIN','GUARD')")
    @Transactional(readOnly = true)
    public List<GateResponse> listGates() {
        return gates.findAllByOrderByNameAsc().stream().map(this::toResponse).toList();
    }

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public void deleteGate(UUID gateId) {
        Gate gate = gates.findById(gateId)
                .orElseThrow(() -> NotFoundException.of("Gate", gateId));
        gates.delete(gate);
        audit.record(AuditAction.GATE_DELETED, "gate", gateId, null);
    }

    // ----- internal lookups used by other services --------------------------------------------

    @Transactional(readOnly = true)
    public Gate requireGate(UUID gateId) {
        return gates.findById(gateId).orElseThrow(() -> NotFoundException.of("Gate", gateId));
    }

    @Transactional(readOnly = true)
    public Flat requireFlat(UUID flatId) {
        return flats.findById(flatId).orElseThrow(() -> NotFoundException.of("Flat", flatId));
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
