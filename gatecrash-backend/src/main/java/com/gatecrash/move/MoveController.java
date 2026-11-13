package com.gatecrash.move;

import com.gatecrash.common.PageResponse;
import com.gatecrash.move.dto.MoveDtos.CompleteMoveRequest;
import com.gatecrash.move.dto.MoveDtos.CreateMoveRequest;
import com.gatecrash.move.dto.MoveDtos.DecideMoveRequest;
import com.gatecrash.move.dto.MoveDtos.MoveResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@RestController
@RequiredArgsConstructor
@Tag(name = "Move-in / move-out")
public class MoveController {

    private final MoveService moves;

    @PostMapping("/api/v1/move-requests")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Resident requests a move-in or move-out slot")
    public MoveResponse request(@Valid @RequestBody CreateMoveRequest request) {
        return moves.request(request);
    }

    @GetMapping("/api/v1/move-requests/mine")
    @Operation(summary = "The resident's own move requests")
    public List<MoveResponse> mine() {
        return moves.mine();
    }

    @PostMapping("/api/v1/move-requests/{id}/cancel")
    @Operation(summary = "Resident cancels a pending or approved move")
    public MoveResponse cancel(@PathVariable UUID id) {
        return moves.cancel(id);
    }

    @GetMapping("/api/v1/move-requests/today")
    @Operation(summary = "Approved moves happening today: the guard's material gate pass")
    public List<MoveResponse> today() {
        return moves.today();
    }

    @GetMapping("/api/v1/admin/move-requests")
    @Operation(summary = "The township's move requests, with each unit's unpaid dues")
    public PageResponse<MoveResponse> list(@RequestParam(required = false) MoveStatus status,
                                           @PageableDefault(size = 25) Pageable pageable) {
        return moves.list(status, pageable);
    }

    @PostMapping("/api/v1/admin/move-requests/{id}/decision")
    @Operation(summary = "Office approves or rejects a move")
    public MoveResponse decide(@PathVariable UUID id, @Valid @RequestBody DecideMoveRequest request) {
        return moves.decide(id, request.decision(), request.note());
    }

    @PostMapping("/api/v1/admin/move-requests/{id}/complete")
    @Operation(summary = "Office marks a move done; a move-out can deactivate the household's accounts")
    public MoveResponse complete(@PathVariable UUID id, @Valid @RequestBody CompleteMoveRequest request) {
        return moves.complete(id, request.deactivateResidents());
    }
}
