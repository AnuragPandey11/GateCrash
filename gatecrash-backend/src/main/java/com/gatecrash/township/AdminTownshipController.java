package com.gatecrash.township;

import com.gatecrash.township.dto.TownshipDtos.BlockResponse;
import com.gatecrash.township.dto.TownshipDtos.CreateBlockRequest;
import com.gatecrash.township.dto.TownshipDtos.CreateFlatRequest;
import com.gatecrash.township.dto.TownshipDtos.CreateGateRequest;
import com.gatecrash.township.dto.TownshipDtos.FlatResponse;
import com.gatecrash.township.dto.TownshipDtos.GateResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * Township structure CRUD. Reads are open to guards as well as admins (they need blocks, flats and
 * gates to log a walk-in); writes are admin-only, enforced in {@link TownshipService}.
 */
@RestController
@RequestMapping("/api/v1/admin")
@RequiredArgsConstructor
@Tag(name = "Admin - Township")
public class AdminTownshipController {

    private final TownshipService township;

    @PostMapping("/blocks")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Create a building block")
    public BlockResponse createBlock(@Valid @RequestBody CreateBlockRequest request) {
        return township.createBlock(request);
    }

    @GetMapping("/blocks")
    @Operation(summary = "List building blocks")
    public List<BlockResponse> listBlocks() {
        return township.listBlocks();
    }

    @DeleteMapping("/blocks/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Delete an empty building block")
    public void deleteBlock(@PathVariable UUID id) {
        township.deleteBlock(id);
    }

    @PostMapping("/flats")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Create a flat")
    public FlatResponse createFlat(@Valid @RequestBody CreateFlatRequest request) {
        return township.createFlat(request);
    }

    @GetMapping("/flats")
    @Operation(summary = "List flats, optionally filtered by block")
    public List<FlatResponse> listFlats(@RequestParam(required = false) UUID blockId) {
        return township.listFlats(blockId);
    }

    @DeleteMapping("/flats/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Delete an unoccupied flat")
    public void deleteFlat(@PathVariable UUID id) {
        township.deleteFlat(id);
    }

    @PostMapping("/gates")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Create a gate")
    public GateResponse createGate(@Valid @RequestBody CreateGateRequest request) {
        return township.createGate(request);
    }

    @GetMapping("/gates")
    @Operation(summary = "List gates")
    public List<GateResponse> listGates() {
        return township.listGates();
    }

    @DeleteMapping("/gates/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Delete a gate")
    public void deleteGate(@PathVariable UUID id) {
        township.deleteGate(id);
    }
}
