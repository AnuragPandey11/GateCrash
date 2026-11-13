package com.gatecrash.rules;

import com.gatecrash.common.AfterCommitExecutor;
import com.gatecrash.common.PageResponse;
import com.gatecrash.common.TownshipClock;
import com.gatecrash.common.audit.AuditAction;
import com.gatecrash.common.audit.AuditService;
import com.gatecrash.common.exception.BusinessValidationException;
import com.gatecrash.common.exception.ConflictException;
import com.gatecrash.common.exception.ForbiddenException;
import com.gatecrash.common.exception.NotFoundException;
import com.gatecrash.common.tenant.TenantContext;
import com.gatecrash.push.UserNotifier;
import com.gatecrash.rules.dto.EntryRuleDtos.CreateRuleRequest;
import com.gatecrash.rules.dto.EntryRuleDtos.RuleDecision;
import com.gatecrash.rules.dto.EntryRuleDtos.RuleResponse;
import com.gatecrash.security.AppUserDetails;
import com.gatecrash.security.SecurityUtils;
import com.gatecrash.user.AppUser;
import com.gatecrash.user.AppUserRepository;
import com.gatecrash.user.UserRole;
import com.gatecrash.visit.VisitorType;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Pageable;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.EnumSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

/**
 * Society rules: auto-entry for the visitors a home trusts.
 *
 * <p>The flow is request → decide: a resident asks, the society office approves or rejects, and
 * either side can end an approved rule (the resident withdraws it, the office revokes it). The
 * gate consults {@link #findMatching} for every walk-in to a home; a match is approved on the spot.
 *
 * <p>Matching is deliberately conservative. Only APPROVED rules count, only for the visitor type
 * they name, only inside their date and daily window, and a rule that names a company, person or
 * phone must actually match it. A guest or technician rule must name someone — "let any guest in"
 * would turn the gate into an open door.
 */
@Service
@RequiredArgsConstructor
public class EntryRuleService {

    public static final String KIND = "RULE";

    private static final int MAX_OPEN_RULES_PER_HOME = 20;
    private static final int MAX_VALIDITY_DAYS = 366;

    private final EntryRuleRepository rules;
    private final AppUserRepository users;
    private final TownshipClock clock;
    private final AuditService audit;
    private final UserNotifier notifier;
    private final AfterCommitExecutor afterCommit;

    // ----- resident -----------------------------------------------------------------------------

    @PreAuthorize("hasRole('RESIDENT')")
    @Transactional
    public RuleResponse request(CreateRuleRequest request) {
        UUID townshipId = TenantContext.requireTownshipId();
        UUID me = SecurityUtils.currentUserId();
        AppUser resident = users.findByIdAndTownship_Id(me, townshipId)
                .orElseThrow(() -> NotFoundException.of("User", me));
        if (resident.getUnit() == null) {
            throw new BusinessValidationException("NO_UNIT", "Your account is not linked to a home.");
        }

        String matchText = blankToNull(request.matchText());
        String phone = blankToNull(request.visitorPhone());
        if (request.visitorType() != VisitorType.DELIVERY && matchText == null && phone == null) {
            throw new BusinessValidationException("RULE_TOO_BROAD",
                    "Name the person or company, or give their phone number. Only deliveries can be allowed in general.");
        }
        if ((request.allowedFrom() == null) != (request.allowedTo() == null)) {
            throw new BusinessValidationException("INVALID_WINDOW", "Give both a start and an end time, or neither.");
        }
        if (request.allowedFrom() != null && !request.allowedTo().isAfter(request.allowedFrom())) {
            throw new BusinessValidationException("INVALID_WINDOW", "The end time must be after the start time.");
        }
        OffsetDateTime now = OffsetDateTime.now();
        if (request.validUntil() != null
                && (!request.validUntil().isAfter(now) || request.validUntil().isAfter(now.plusDays(MAX_VALIDITY_DAYS)))) {
            throw new BusinessValidationException("INVALID_DATE", "The end date must be within the next year.");
        }
        if (rules.countByUnit_IdAndStatusIn(resident.getUnit().getId(),
                EnumSet.of(EntryRuleStatus.PENDING, EntryRuleStatus.APPROVED)) >= MAX_OPEN_RULES_PER_HOME) {
            throw new ConflictException("TOO_MANY_RULES",
                    "Your home already has " + MAX_OPEN_RULES_PER_HOME + " rules. Withdraw one first.");
        }

        EntryRule rule = new EntryRule();
        rule.setTownshipId(townshipId);
        rule.setUnit(resident.getUnit());
        rule.setRequestedBy(resident);
        rule.setVisitorType(request.visitorType());
        rule.setLabel(request.label().trim());
        rule.setMatchText(matchText);
        rule.setVisitorPhone(phone);
        rule.setAllowedFrom(request.allowedFrom());
        rule.setAllowedTo(request.allowedTo());
        rule.setValidUntil(request.validUntil());
        rule.setNote(blankToNull(request.note()));
        rules.save(rule);
        audit.record(AuditAction.RULE_REQUESTED, "entry_rule", rule.getId(),
                AuditService.detail("visitorType", rule.getVisitorType(), "unitId", resident.getUnit().getId()));

        List<UUID> admins = users.findByTownship_IdAndRoleOrderByFullNameAsc(townshipId, UserRole.ADMIN)
                .stream().filter(AppUser::isActive).map(AppUser::getId).toList();
        UUID ruleId = rule.getId();
        String title = "Auto-entry request from " + resident.getUnitCode();
        String body = rule.getLabel();
        afterCommit.execute(() -> notifier.notify(admins, KIND, ruleId, title, body));
        return toResponse(rule);
    }

    /** Every rule of the caller's home, whoever in the household asked. */
    @PreAuthorize("hasRole('RESIDENT')")
    @Transactional(readOnly = true)
    public List<RuleResponse> mine() {
        AppUserDetails caller = SecurityUtils.currentUser();
        if (caller.getFlatId() == null) {
            return List.of();
        }
        return rules.findTop50ByTownshipIdAndUnit_IdOrderByCreatedAtDesc(
                        TenantContext.requireTownshipId(), caller.getFlatId())
                .stream().map(this::toResponse).toList();
    }

    @PreAuthorize("hasRole('RESIDENT')")
    @Transactional
    public RuleResponse cancel(UUID ruleId) {
        EntryRule rule = lock(ruleId);
        AppUserDetails caller = SecurityUtils.currentUser();
        // Any resident of the home, not only the one who asked: the rule belongs to the home.
        if (caller.getFlatId() == null || !caller.getFlatId().equals(rule.getUnit().getId())) {
            throw new ForbiddenException("This rule is not for your home.");
        }
        transition(rule, EntryRuleStatus.CANCELLED);
        audit.record(AuditAction.RULE_CANCELLED, "entry_rule", ruleId, null);
        return toResponse(rule);
    }

    // ----- office -------------------------------------------------------------------------------

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional(readOnly = true)
    public PageResponse<RuleResponse> list(EntryRuleStatus status, Pageable pageable) {
        UUID townshipId = TenantContext.requireTownshipId();
        return PageResponse.of(status == null
                ? rules.findByTownshipIdOrderByCreatedAtDesc(townshipId, pageable)
                : rules.findByTownshipIdAndStatusOrderByCreatedAtDesc(townshipId, status, pageable),
                this::toResponse);
    }

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public RuleResponse decide(UUID ruleId, RuleDecision decision, String note) {
        EntryRule rule = lock(ruleId);
        EntryRuleStatus target = decision == RuleDecision.APPROVED ? EntryRuleStatus.APPROVED : EntryRuleStatus.REJECTED;
        if (target == EntryRuleStatus.REJECTED && (note == null || note.isBlank())) {
            throw new BusinessValidationException("REASON_REQUIRED", "Tell the resident why it was rejected.");
        }
        transition(rule, target);
        rule.setAdminNote(blankToNull(note));
        rule.setDecidedBy(users.getReferenceById(SecurityUtils.currentUserId()));
        rule.setDecidedAt(OffsetDateTime.now());
        audit.record(AuditAction.RULE_DECIDED, "entry_rule", ruleId, AuditService.detail("decision", target));
        tell(rule, target == EntryRuleStatus.APPROVED
                ? "Auto-entry approved: " + rule.getLabel()
                : "Auto-entry rejected: " + rule.getLabel());
        return toResponse(rule);
    }

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public RuleResponse revoke(UUID ruleId, String note) {
        EntryRule rule = lock(ruleId);
        transition(rule, EntryRuleStatus.REVOKED);
        rule.setAdminNote(blankToNull(note));
        rule.setDecidedBy(users.getReferenceById(SecurityUtils.currentUserId()));
        rule.setDecidedAt(OffsetDateTime.now());
        audit.record(AuditAction.RULE_REVOKED, "entry_rule", ruleId, null);
        tell(rule, "Auto-entry revoked: " + rule.getLabel());
        return toResponse(rule);
    }

    // ----- the gate -----------------------------------------------------------------------------

    /**
     * The rule, if any, that admits this walk-in to this home right now. Called by
     * {@code VisitService} inside the guard's transaction; the unit was already resolved within the
     * tenant, so this needs no tenant check of its own.
     */
    @Transactional(readOnly = true)
    public Optional<EntryRule> findMatching(UUID unitId, VisitorType type, String visitorName, String purpose,
                                            String phone) {
        OffsetDateTime now = OffsetDateTime.now();
        LocalTime localNow = now.atZoneSameInstant(clock.zone()).toLocalTime();
        String haystack = ((visitorName == null ? "" : visitorName) + " " + (purpose == null ? "" : purpose))
                .toLowerCase(Locale.ROOT);
        String digits = phone == null ? "" : lastTen(phone);
        return rules.findByUnit_IdAndStatusAndVisitorType(unitId, EntryRuleStatus.APPROVED, type).stream()
                .filter(r -> r.getValidUntil() == null || r.getValidUntil().isAfter(now))
                .filter(r -> r.getAllowedFrom() == null
                        || (!localNow.isBefore(r.getAllowedFrom()) && localNow.isBefore(r.getAllowedTo())))
                .filter(r -> r.getMatchText() == null || haystack.contains(r.getMatchText().toLowerCase(Locale.ROOT)))
                .filter(r -> r.getVisitorPhone() == null || (!digits.isEmpty() && digits.equals(lastTen(r.getVisitorPhone()))))
                .findFirst();
    }

    // ----- internals ----------------------------------------------------------------------------

    private void tell(EntryRule rule, String title) {
        UUID requesterId = rule.getRequestedBy().getId();
        UUID ruleId = rule.getId();
        String body = rule.getAdminNote();
        afterCommit.execute(() -> notifier.notify(List.of(requesterId), KIND, ruleId, title, body));
    }

    private EntryRule lock(UUID ruleId) {
        return rules.findByIdForUpdate(ruleId, TenantContext.requireTownshipId())
                .orElseThrow(() -> NotFoundException.of("Rule", ruleId));
    }

    private void transition(EntryRule rule, EntryRuleStatus target) {
        if (!rule.getStatus().canTransitionTo(target)) {
            throw ConflictException.illegalTransition("Rule", rule.getStatus(), target);
        }
        rule.setStatus(target);
        rules.save(rule);
    }

    /** Compare phone numbers on their last ten digits: "+91 98765 43210" and "9876543210" are one number. */
    private static String lastTen(String phone) {
        String d = phone.replaceAll("\\D", "");
        return d.length() > 10 ? d.substring(d.length() - 10) : d;
    }

    private RuleResponse toResponse(EntryRule r) {
        return new RuleResponse(r.getId(), r.getUnit().getCode(), r.getRequestedBy().getFullName(),
                r.getVisitorType(), r.getLabel(), r.getMatchText(), r.getVisitorPhone(), r.getAllowedFrom(),
                r.getAllowedTo(), r.getValidUntil(), r.getNote(), r.getStatus(), r.getAdminNote(),
                r.getDecidedBy() == null ? null : r.getDecidedBy().getFullName(), r.getDecidedAt(),
                r.getCreatedAt());
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
