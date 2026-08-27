package com.gatecrash.township;

import com.gatecrash.township.dto.TownshipDtos.CreateGateRequest;
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
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * Gate CRUD. Reads are open to guards as well as admins (they need the gate list to log a walk-in);
 * writes are admin-only, enforced in {@link TownshipService}.
 *
 * <p>The blocks and flats endpoints that used to live here moved to
 * {@code /api/v1/admin/property/**} in V4, where a township's hierarchy is whatever shape its
 * developer actually builds -- see {@link com.gatecrash.property.AdminPropertyController}.
 */
@RestController
@RequestMapping("/api/v1/admin")
@RequiredArgsConstructor
@Tag(name = "Admin - Gates")
public class AdminTownshipController {

    private final TownshipService township;

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
