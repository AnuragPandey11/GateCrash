package com.gatecrash.helpdesk;

import com.gatecrash.common.PageResponse;
import com.gatecrash.helpdesk.dto.HelpdeskDtos.RaiseTicketRequest;
import com.gatecrash.helpdesk.dto.HelpdeskDtos.ReplyRequest;
import com.gatecrash.helpdesk.dto.HelpdeskDtos.StatusRequest;
import com.gatecrash.helpdesk.dto.HelpdeskDtos.TicketDetail;
import com.gatecrash.helpdesk.dto.HelpdeskDtos.TicketSummary;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequiredArgsConstructor
@Tag(name = "Help & Support")
public class HelpdeskController {

    private final HelpdeskService helpdesk;

    @PostMapping("/api/v1/support-tickets")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Resident raises a help request")
    public TicketDetail raise(@Valid @RequestBody RaiseTicketRequest request) {
        return helpdesk.raise(request);
    }

    @GetMapping("/api/v1/support-tickets/mine")
    @Operation(summary = "The resident's own tickets")
    public PageResponse<TicketSummary> mine(@PageableDefault(size = 20) Pageable pageable) {
        return helpdesk.mine(pageable);
    }

    @GetMapping("/api/v1/support-tickets/{id}")
    @Operation(summary = "One ticket with its thread (owner or admin)")
    public TicketDetail get(@PathVariable UUID id) {
        return helpdesk.get(id);
    }

    @PostMapping("/api/v1/support-tickets/{id}/messages")
    @Operation(summary = "Reply on a ticket (owner or admin)")
    public TicketDetail reply(@PathVariable UUID id, @Valid @RequestBody ReplyRequest request) {
        return helpdesk.reply(id, request.body());
    }

    @PostMapping("/api/v1/support-tickets/{id}/reopen")
    @Operation(summary = "Resident reopens a resolved ticket")
    public TicketDetail reopen(@PathVariable UUID id) {
        return helpdesk.reopen(id);
    }

    @PostMapping("/api/v1/support-tickets/{id}/close")
    @Operation(summary = "Resident closes their ticket")
    public TicketDetail close(@PathVariable UUID id) {
        return helpdesk.close(id);
    }

    @GetMapping("/api/v1/admin/support-tickets")
    @Operation(summary = "The township's help desk queue")
    public PageResponse<TicketSummary> list(@RequestParam(required = false) TicketStatus status,
                                           @PageableDefault(size = 25) Pageable pageable) {
        return helpdesk.list(status, pageable);
    }

    @PatchMapping("/api/v1/admin/support-tickets/{id}/status")
    @Operation(summary = "Office moves a ticket to in progress, resolved or closed")
    public TicketDetail setStatus(@PathVariable UUID id, @Valid @RequestBody StatusRequest request) {
        return helpdesk.setStatus(id, request.status());
    }
}
