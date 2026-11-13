package com.gatecrash.pass;

import com.gatecrash.common.PageResponse;
import com.gatecrash.pass.dto.PassDtos.CreatePassRequest;
import com.gatecrash.pass.dto.PassDtos.LookupPassRequest;
import com.gatecrash.pass.dto.PassDtos.PassPreviewResponse;
import com.gatecrash.pass.dto.PassDtos.CreatePassResponse;
import com.gatecrash.pass.dto.PassDtos.PassResponse;
import com.gatecrash.pass.dto.PassDtos.RedeemPassRequest;
import com.gatecrash.pass.dto.PassDtos.RedeemPassResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequestMapping("/api/v1/passes")
@RequiredArgsConstructor
@Tag(name = "Passes")
public class PassController {

    private final PassService passes;

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Mint a time-bound pass; returns the PIN and QR token exactly once")
    public CreatePassResponse create(@Valid @RequestBody CreatePassRequest request) {
        return passes.createPass(request);
    }

    @GetMapping("/mine")
    @Operation(summary = "Passes minted by the caller")
    public PageResponse<PassResponse> mine(
            @PageableDefault(size = 25, sort = "createdAt", direction = Sort.Direction.DESC) Pageable pageable) {
        return passes.listMine(pageable);
    }

    @PostMapping("/lookup")
    @Operation(summary = "Guard scans a QR or types a PIN: the pass's details, pre-filled, without using it")
    public PassPreviewResponse lookup(@Valid @RequestBody LookupPassRequest request) {
        return passes.lookup(request);
    }

    @PostMapping("/redeem")
    @Operation(summary = "Guard redeems a pass by PIN or QR; creates a CHECKED_IN visit immediately")
    public RedeemPassResponse redeem(@Valid @RequestBody RedeemPassRequest request) {
        return passes.redeem(request);
    }

    @DeleteMapping("/{id}")
    @Operation(summary = "Revoke a pass the caller created")
    public PassResponse revoke(@PathVariable UUID id) {
        return passes.revoke(id);
    }
}
