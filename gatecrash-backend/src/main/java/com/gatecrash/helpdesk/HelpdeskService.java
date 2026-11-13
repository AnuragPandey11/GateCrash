package com.gatecrash.helpdesk;

import com.gatecrash.common.AfterCommitExecutor;
import com.gatecrash.common.PageResponse;
import com.gatecrash.common.audit.AuditAction;
import com.gatecrash.common.audit.AuditService;
import com.gatecrash.common.exception.BusinessValidationException;
import com.gatecrash.common.exception.ConflictException;
import com.gatecrash.common.exception.ForbiddenException;
import com.gatecrash.common.exception.NotFoundException;
import com.gatecrash.common.tenant.TenantContext;
import com.gatecrash.helpdesk.dto.HelpdeskDtos.MessageResponse;
import com.gatecrash.helpdesk.dto.HelpdeskDtos.RaiseTicketRequest;
import com.gatecrash.helpdesk.dto.HelpdeskDtos.TicketDetail;
import com.gatecrash.helpdesk.dto.HelpdeskDtos.TicketSummary;
import com.gatecrash.push.UserNotifier;
import com.gatecrash.security.AppUserDetails;
import com.gatecrash.security.SecurityUtils;
import com.gatecrash.user.AppUser;
import com.gatecrash.user.AppUserRepository;
import com.gatecrash.user.UserRole;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Pageable;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * Help &amp; Support: a resident raises a ticket, the society office works it, and the two talk in a
 * thread until it is resolved.
 *
 * <p>Layer two of the security model is the point of most of this class: a resident token can
 * read and reply to <em>its own</em> tickets only, and every ticket lookup is anchored on the
 * acting township, so another township's ticket id is a 404 before ownership is even asked.
 */
@Service
@RequiredArgsConstructor
public class HelpdeskService {

    public static final String KIND = "TICKET";

    private final SupportTicketRepository tickets;
    private final AppUserRepository users;
    private final AuditService audit;
    private final UserNotifier notifier;
    private final AfterCommitExecutor afterCommit;

    // ----- resident -----------------------------------------------------------------------------

    @PreAuthorize("hasRole('RESIDENT')")
    @Transactional
    public TicketDetail raise(RaiseTicketRequest request) {
        AppUserDetails caller = SecurityUtils.currentUser();
        UUID townshipId = TenantContext.requireTownshipId();
        AppUser raiser = users.findByIdAndTownship_Id(caller.getId(), townshipId)
                .orElseThrow(() -> NotFoundException.of("User", caller.getId()));

        SupportTicket ticket = new SupportTicket();
        ticket.setTownshipId(townshipId);
        ticket.setRaisedBy(raiser);
        ticket.setUnit(raiser.getUnit());
        ticket.setCategory(request.category());
        ticket.setSubject(request.subject().trim());
        ticket.setDescription(request.description().trim());
        tickets.save(ticket);
        audit.record(AuditAction.TICKET_RAISED, "support_ticket", ticket.getId(),
                AuditService.detail("category", ticket.getCategory()));

        // The office hears about it at once rather than on their next look at the queue.
        List<UUID> admins = users.findByTownship_IdAndRoleOrderByFullNameAsc(townshipId, UserRole.ADMIN)
                .stream().filter(AppUser::isActive).map(AppUser::getId).toList();
        UUID ticketId = ticket.getId();
        String unit = raiser.getUnitCode() == null ? "" : " (" + raiser.getUnitCode() + ")";
        String title = "New help request" + unit;
        String body = ticket.getSubject();
        afterCommit.execute(() -> notifier.notify(admins, KIND, ticketId, title, body));
        return toDetail(ticket);
    }

    @PreAuthorize("hasRole('RESIDENT')")
    @Transactional(readOnly = true)
    public PageResponse<TicketSummary> mine(Pageable pageable) {
        return PageResponse.of(tickets.findByTownshipIdAndRaisedBy_IdOrderByCreatedAtDesc(
                TenantContext.requireTownshipId(), SecurityUtils.currentUserId(), pageable), this::toSummary);
    }

    /** The resident's "it is not fixed" button. */
    @PreAuthorize("hasRole('RESIDENT')")
    @Transactional
    public TicketDetail reopen(UUID ticketId) {
        SupportTicket ticket = lockOwned(ticketId);
        if (ticket.getStatus() != TicketStatus.RESOLVED) {
            throw new ConflictException("NOT_RESOLVED", "Only a resolved ticket can be reopened.");
        }
        move(ticket, TicketStatus.OPEN);
        ticket.setResolvedAt(null);
        return toDetail(ticket);
    }

    @PreAuthorize("hasRole('RESIDENT')")
    @Transactional
    public TicketDetail close(UUID ticketId) {
        SupportTicket ticket = lockOwned(ticketId);
        move(ticket, TicketStatus.CLOSED);
        return toDetail(ticket);
    }

    // ----- both sides ---------------------------------------------------------------------------

    @PreAuthorize("hasAnyRole('RESIDENT','ADMIN')")
    @Transactional(readOnly = true)
    public TicketDetail get(UUID ticketId) {
        SupportTicket ticket = tickets.findByIdAndTownshipId(ticketId, TenantContext.requireTownshipId())
                .orElseThrow(() -> NotFoundException.of("Ticket", ticketId));
        requireVisible(ticket);
        return toDetail(ticket);
    }

    /**
     * A reply from either side. The office replying to an open ticket also moves it to
     * IN_PROGRESS -- the resident should see that someone has picked it up -- and the other party is
     * notified either way.
     */
    @PreAuthorize("hasAnyRole('RESIDENT','ADMIN')")
    @Transactional
    public TicketDetail reply(UUID ticketId, String body) {
        AppUserDetails caller = SecurityUtils.currentUser();
        SupportTicket ticket = tickets.findByIdForUpdate(ticketId, TenantContext.requireTownshipId())
                .orElseThrow(() -> NotFoundException.of("Ticket", ticketId));
        requireVisible(ticket);
        if (ticket.getStatus() == TicketStatus.CLOSED) {
            throw new ConflictException("TICKET_CLOSED", "This ticket is closed.");
        }
        boolean staff = caller.getRole().isAdministrative();

        TicketMessage message = new TicketMessage();
        message.setTownshipId(ticket.getTownshipId());
        message.setTicket(ticket);
        message.setAuthor(users.getReferenceById(caller.getId()));
        message.setFromStaff(staff);
        message.setBody(body.trim());
        ticket.getMessages().add(message);
        if (staff && ticket.getStatus() == TicketStatus.OPEN) {
            ticket.setStatus(TicketStatus.IN_PROGRESS);
        }
        tickets.saveAndFlush(ticket);
        audit.record(AuditAction.TICKET_REPLIED, "support_ticket", ticketId,
                AuditService.detail("fromStaff", staff));

        if (staff) {
            UUID raiserId = ticket.getRaisedBy().getId();
            String subject = ticket.getSubject();
            afterCommit.execute(() -> notifier.notify(List.of(raiserId), KIND, ticketId,
                    "Reply on your request", subject));
        }
        return toDetail(ticket);
    }

    // ----- office -------------------------------------------------------------------------------

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional(readOnly = true)
    public PageResponse<TicketSummary> list(TicketStatus status, Pageable pageable) {
        UUID townshipId = TenantContext.requireTownshipId();
        return PageResponse.of(status == null
                ? tickets.findByTownshipIdOrderByCreatedAtDesc(townshipId, pageable)
                : tickets.findByTownshipIdAndStatusOrderByCreatedAtDesc(townshipId, status, pageable),
                this::toSummary);
    }

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public TicketDetail setStatus(UUID ticketId, TicketStatus status) {
        if (status == TicketStatus.OPEN) {
            throw new BusinessValidationException("STATUS_NOT_ALLOWED",
                    "Reopening is the resident's call; the office moves tickets forward.");
        }
        SupportTicket ticket = tickets.findByIdForUpdate(ticketId, TenantContext.requireTownshipId())
                .orElseThrow(() -> NotFoundException.of("Ticket", ticketId));
        move(ticket, status);
        if (status == TicketStatus.RESOLVED) {
            ticket.setResolvedAt(OffsetDateTime.now());
        }
        UUID raiserId = ticket.getRaisedBy().getId();
        String title = switch (status) {
            case IN_PROGRESS -> "Your request is being worked on";
            case RESOLVED -> "Your request has been resolved";
            case CLOSED -> "Your request has been closed";
            default -> "Your request was updated";
        };
        String subject = ticket.getSubject();
        afterCommit.execute(() -> notifier.notify(List.of(raiserId), KIND, ticketId, title, subject));
        return toDetail(ticket);
    }

    // ----- internals ----------------------------------------------------------------------------

    private SupportTicket lockOwned(UUID ticketId) {
        SupportTicket ticket = tickets.findByIdForUpdate(ticketId, TenantContext.requireTownshipId())
                .orElseThrow(() -> NotFoundException.of("Ticket", ticketId));
        if (!ticket.getRaisedBy().getId().equals(SecurityUtils.currentUserId())) {
            throw new ForbiddenException("This is not your ticket.");
        }
        return ticket;
    }

    /** The office sees every ticket in the township; a resident sees only their own. */
    private void requireVisible(SupportTicket ticket) {
        AppUserDetails caller = SecurityUtils.currentUser();
        if (!caller.getRole().isAdministrative() && !ticket.getRaisedBy().getId().equals(caller.getId())) {
            throw new ForbiddenException("This is not your ticket.");
        }
    }

    private void move(SupportTicket ticket, TicketStatus target) {
        if (!ticket.getStatus().canTransitionTo(target)) {
            throw ConflictException.illegalTransition("Ticket", ticket.getStatus(), target);
        }
        TicketStatus from = ticket.getStatus();
        ticket.setStatus(target);
        tickets.save(ticket);
        audit.record(AuditAction.TICKET_STATUS_CHANGED, "support_ticket", ticket.getId(),
                AuditService.detail("from", from, "to", target));
    }

    private TicketSummary toSummary(SupportTicket ticket) {
        return new TicketSummary(ticket.getId(), ticket.getCategory(), ticket.getSubject(),
                ticket.getStatus(), ticket.getUnit() == null ? null : ticket.getUnit().getCode(),
                ticket.getRaisedBy().getFullName(), ticket.getMessages().size(),
                ticket.getCreatedAt(), ticket.getUpdatedAt());
    }

    private TicketDetail toDetail(SupportTicket ticket) {
        List<MessageResponse> messages = ticket.getMessages().stream()
                .map(m -> new MessageResponse(m.getId(), m.getAuthor().getFullName(), m.isFromStaff(),
                        m.getBody(), m.getCreatedAt()))
                .toList();
        return new TicketDetail(ticket.getId(), ticket.getCategory(), ticket.getSubject(),
                ticket.getDescription(), ticket.getStatus(),
                ticket.getUnit() == null ? null : ticket.getUnit().getCode(),
                ticket.getRaisedBy().getFullName(), ticket.getResolvedAt(), ticket.getCreatedAt(),
                ticket.getUpdatedAt(), messages);
    }
}
