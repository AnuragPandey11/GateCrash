package com.gatecrash.rules;

import com.gatecrash.common.PageResponse;
import com.gatecrash.rules.dto.EntryRuleDtos.CreateRuleRequest;
import com.gatecrash.rules.dto.EntryRuleDtos.DecideRuleRequest;
import com.gatecrash.rules.dto.EntryRuleDtos.RevokeRuleRequest;
import com.gatecrash.rules.dto.EntryRuleDtos.RuleResponse;
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
@Tag(name = "Society rules")
public class EntryRuleController {

    private final EntryRuleService rules;

    @PostMapping("/api/v1/entry-rules")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Resident asks for a kind of visitor to be let in automatically")
    public RuleResponse request(@Valid @RequestBody CreateRuleRequest request) {
        return rules.request(request);
    }

    @GetMapping("/api/v1/entry-rules/mine")
    @Operation(summary = "The rules of the resident's home")
    public List<RuleResponse> mine() {
        return rules.mine();
    }

    @PostMapping("/api/v1/entry-rules/{id}/cancel")
    @Operation(summary = "A resident of the home withdraws a pending or approved rule")
    public RuleResponse cancel(@PathVariable UUID id) {
        return rules.cancel(id);
    }

    @GetMapping("/api/v1/admin/entry-rules")
    @Operation(summary = "The township's rule requests")
    public PageResponse<RuleResponse> list(@RequestParam(required = false) EntryRuleStatus status,
                                           @PageableDefault(size = 25) Pageable pageable) {
        return rules.list(status, pageable);
    }

    @PostMapping("/api/v1/admin/entry-rules/{id}/decision")
    @Operation(summary = "Office approves or rejects a rule request")
    public RuleResponse decide(@PathVariable UUID id, @Valid @RequestBody DecideRuleRequest request) {
        return rules.decide(id, request.decision(), request.note());
    }

    @PostMapping("/api/v1/admin/entry-rules/{id}/revoke")
    @Operation(summary = "Office revokes an approved rule")
    public RuleResponse revoke(@PathVariable UUID id, @Valid @RequestBody(required = false) RevokeRuleRequest request) {
        return rules.revoke(id, request == null ? null : request.note());
    }
}
