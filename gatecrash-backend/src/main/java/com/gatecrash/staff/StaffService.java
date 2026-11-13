package com.gatecrash.staff;

import com.gatecrash.common.AfterCommitExecutor;
import com.gatecrash.common.TownshipClock;
import com.gatecrash.common.audit.AuditAction;
import com.gatecrash.common.audit.AuditService;
import com.gatecrash.common.exception.BusinessValidationException;
import com.gatecrash.common.exception.ConflictException;
import com.gatecrash.common.exception.ForbiddenException;
import com.gatecrash.common.exception.NotFoundException;
import com.gatecrash.common.exception.TooManyRequestsException;
import com.gatecrash.common.tenant.TenantContext;
import com.gatecrash.config.AppProperties;
import com.gatecrash.pass.PinHasher;
import com.gatecrash.push.UserNotifier;
import com.gatecrash.security.AppUserDetails;
import com.gatecrash.security.FixedWindowRateLimiter;
import com.gatecrash.security.SecurityUtils;
import com.gatecrash.staff.dto.StaffDtos.AttendanceResponse;
import com.gatecrash.staff.dto.StaffDtos.CreateStaffRequest;
import com.gatecrash.staff.dto.StaffDtos.RegisterHelpRequest;
import com.gatecrash.staff.dto.StaffDtos.StaffCreatedResponse;
import com.gatecrash.staff.dto.StaffDtos.StaffResponse;
import com.gatecrash.township.Gate;
import com.gatecrash.township.GateRepository;
import com.gatecrash.user.AppUser;
import com.gatecrash.user.AppUserRepository;
import com.gatecrash.user.PasswordGenerator;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Daily help and society staff: who they are, which homes they work for, and when they came and went.
 *
 * <p><b>Daily help</b> belongs to households. A resident registers a new helper (the 6-digit entry
 * code is shown once, to hand to the helper) or adds one already working in the society by that
 * code; either way the helper is linked to the home. <b>Society staff</b> work for the society and
 * only the office adds them. Everyone gets the same entry code and ID-card QR.
 *
 * <p>At the gate the guard types the code or scans the card, sees who it is and which homes they
 * serve, and marks them in or out. That is the attendance register, and the homes a helper works
 * for are told when they arrive and leave — the household never has to approve its own maid.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class StaffService {

    public static final String KIND = "STAFF";

    private static final int MAX_HELPERS_PER_HOME = 30;
    private static final int CODE_ATTEMPTS = 25;
    private static final int LINK_ATTEMPTS = 10;
    private static final Duration LINK_WINDOW = Duration.ofMinutes(15);
    private static final int MAX_HISTORY_DAYS = 90;

    private final StaffMemberRepository staff;
    private final StaffHouseholdRepository households;
    private final StaffAttendanceRepository attendance;
    private final StaffRatingRepository ratings;
    private final AppUserRepository users;
    private final GateRepository gates;
    private final PinHasher pinHasher;
    private final PasswordGenerator generator;
    private final FixedWindowRateLimiter rateLimiter;
    private final AppProperties properties;
    private final TownshipClock clock;
    private final AuditService audit;
    private final UserNotifier notifier;
    private final AfterCommitExecutor afterCommit;

    /** Which fields of a staff member a caller may see. */
    private enum Audience { OFFICE, HOUSEHOLD, DIRECTORY, GATE }

    // ----- residents ----------------------------------------------------------------------------

    /** The helpers of the caller's home, with today's in/out state. */
    @PreAuthorize("hasRole('RESIDENT')")
    @Transactional(readOnly = true)
    public List<StaffResponse> mine() {
        UUID unitId = SecurityUtils.currentUser().getFlatId();
        if (unitId == null) {
            return List.of();
        }
        List<StaffMember> members = households.findByTownshipIdAndUnit_Id(TenantContext.requireTownshipId(), unitId)
                .stream().map(StaffHousehold::getStaff).toList();
        return present(members, Audience.HOUSEHOLD, unitId);
    }

    @PreAuthorize("hasRole('RESIDENT')")
    @Transactional
    public StaffCreatedResponse register(RegisterHelpRequest request) {
        UUID townshipId = TenantContext.requireTownshipId();
        AppUser resident = me(townshipId);
        UUID unitId = requireUnit(resident);
        String phone = request.phone().trim();
        if (staff.existsByTownshipIdAndPhone(townshipId, phone)) {
            // Say so without revealing who: the helper can tell the resident their code.
            throw new ConflictException("STAFF_EXISTS",
                    "Someone with this phone already works in the society. Ask them for their entry code and add them with it.");
        }
        requireRoomFor(unitId);

        String code = freshCode(townshipId);
        StaffMember member = newMember(townshipId, StaffScope.DAILY_HELP, request.category(),
                request.fullName(), phone, code, resident);
        link(member, resident);
        audit.record(AuditAction.STAFF_REGISTERED, "staff_member", member.getId(),
                AuditService.detail("scope", member.getScope(), "unitId", unitId));
        return new StaffCreatedResponse(one(member, Audience.HOUSEHOLD, unitId), code);
    }

    /** Add a helper who already works in the society, by the code they carry. */
    @PreAuthorize("hasRole('RESIDENT')")
    @Transactional
    public StaffResponse linkByCode(String code) {
        UUID townshipId = TenantContext.requireTownshipId();
        AppUser resident = me(townshipId);
        UUID unitId = requireUnit(resident);
        String limitKey = "staff:link:" + resident.getId();
        if (!rateLimiter.tryAcquire(limitKey, LINK_ATTEMPTS, LINK_WINDOW)) {
            throw new TooManyRequestsException("Too many attempts. Wait a few minutes and try again.");
        }
        StaffMember member = staff.findByTownshipIdAndCodeLookup(townshipId, pinHasher.lookupValue(code))
                .orElseThrow(() -> new NotFoundException("No helper in your society has this code."));
        if (member.getScope() != StaffScope.DAILY_HELP) {
            throw new ConflictException("NOT_DAILY_HELP", "This is society staff — they don't need to be added to a home.");
        }
        if (!member.isActive()) {
            throw new ConflictException("STAFF_INACTIVE", "This helper has been deactivated by the society office.");
        }
        if (households.existsByStaff_IdAndUnit_Id(member.getId(), unitId)) {
            throw new ConflictException("ALREADY_LINKED", member.getFullName() + " already works for your home.");
        }
        requireRoomFor(unitId);
        link(member, resident);
        rateLimiter.reset(limitKey);
        audit.record(AuditAction.STAFF_LINKED, "staff_member", member.getId(), AuditService.detail("unitId", unitId));
        return one(member, Audience.HOUSEHOLD, unitId);
    }

    /** The helper stops working for this home. Their record, and other homes' links, stay. */
    @PreAuthorize("hasRole('RESIDENT')")
    @Transactional
    public void unlink(UUID staffId) {
        UUID unitId = requireUnit(me(TenantContext.requireTownshipId()));
        StaffHousehold link = households.findByStaff_IdAndUnit_Id(staffId, unitId)
                .orElseThrow(() -> NotFoundException.of("Helper", staffId));
        households.delete(link);
        audit.record(AuditAction.STAFF_UNLINKED, "staff_member", staffId, AuditService.detail("unitId", unitId));
    }

    @PreAuthorize("hasRole('RESIDENT')")
    @Transactional
    public StaffResponse rate(UUID staffId, int rating, String review) {
        UUID townshipId = TenantContext.requireTownshipId();
        AppUser resident = me(townshipId);
        UUID unitId = requireUnit(resident);
        StaffMember member = find(staffId, townshipId);
        if (!households.existsByStaff_IdAndUnit_Id(staffId, unitId)) {
            throw new ForbiddenException("Only homes this helper works for can rate them.");
        }
        StaffRating row = ratings.findByStaff_IdAndUnit_Id(staffId, unitId).orElseGet(() -> {
            StaffRating fresh = new StaffRating();
            fresh.setTownshipId(townshipId);
            fresh.setStaff(member);
            fresh.setUnit(resident.getUnit());
            return fresh;
        });
        row.setRating(rating);
        row.setReview(review == null || review.isBlank() ? null : review.trim());
        row.setRatedBy(resident);
        ratings.save(row);
        audit.record(AuditAction.STAFF_RATED, "staff_member", staffId, AuditService.detail("rating", rating));
        return one(member, Audience.HOUSEHOLD, unitId);
    }

    /**
     * Comings and goings. A resident sees only helpers of their own home; the office sees anyone.
     */
    @PreAuthorize("hasAnyRole('RESIDENT', 'ADMIN')")
    @Transactional(readOnly = true)
    public List<AttendanceResponse> history(UUID staffId, int days) {
        UUID townshipId = TenantContext.requireTownshipId();
        find(staffId, townshipId);
        AppUserDetails caller = SecurityUtils.currentUser();
        boolean office = caller.getAuthorities().stream().anyMatch(a -> "ROLE_ADMIN".equals(a.getAuthority()));
        if (!office && (caller.getFlatId() == null || !households.existsByStaff_IdAndUnit_Id(staffId, caller.getFlatId()))) {
            throw new ForbiddenException("This helper does not work for your home.");
        }
        int span = Math.max(1, Math.min(days, MAX_HISTORY_DAYS));
        OffsetDateTime since = clock.at(clock.today().minusDays(span - 1L), LocalTime.MIDNIGHT);
        return attendance.findByStaff_IdAndCheckedInAtAfterOrderByCheckedInAtDesc(staffId, since)
                .stream().map(StaffService::toAttendance).toList();
    }

    /** Everyone working in the society, to find a helper or call the plumber. */
    @PreAuthorize("hasAnyRole('RESIDENT', 'ADMIN')")
    @Transactional(readOnly = true)
    public List<StaffResponse> directory() {
        return present(staff.findByTownshipIdAndActiveTrueOrderByFullNameAsc(TenantContext.requireTownshipId()),
                Audience.DIRECTORY, null);
    }

    // ----- office -------------------------------------------------------------------------------

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional(readOnly = true)
    public List<StaffResponse> list() {
        return present(staff.findByTownshipIdOrderByFullNameAsc(TenantContext.requireTownshipId()),
                Audience.OFFICE, null);
    }

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public StaffCreatedResponse create(CreateStaffRequest request) {
        UUID townshipId = TenantContext.requireTownshipId();
        String phone = request.phone() == null || request.phone().isBlank() ? null : request.phone().trim();
        if (phone != null && staff.existsByTownshipIdAndPhone(townshipId, phone)) {
            throw new ConflictException("STAFF_EXISTS", "A staff member with this phone is already registered.");
        }
        String code = freshCode(townshipId);
        StaffMember member = newMember(townshipId, request.scope(), request.category(), request.fullName(),
                phone, code, users.getReferenceById(SecurityUtils.currentUserId()));
        audit.record(AuditAction.STAFF_REGISTERED, "staff_member", member.getId(),
                AuditService.detail("scope", member.getScope()));
        return new StaffCreatedResponse(one(member, Audience.OFFICE, null), code);
    }

    /** A new code and a new card; the old ones stop working at once. */
    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public StaffCreatedResponse reissueCode(UUID staffId) {
        UUID townshipId = TenantContext.requireTownshipId();
        StaffMember member = staff.findByIdForUpdate(staffId, townshipId)
                .orElseThrow(() -> NotFoundException.of("Staff member", staffId));
        String code = freshCode(townshipId);
        member.setCodeLookup(pinHasher.lookupValue(code));
        member.setQrToken(UUID.randomUUID());
        staff.save(member);
        audit.record(AuditAction.STAFF_CODE_REISSUED, "staff_member", staffId, null);
        return new StaffCreatedResponse(one(member, Audience.OFFICE, null), code);
    }

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public StaffResponse setActive(UUID staffId, boolean active) {
        UUID townshipId = TenantContext.requireTownshipId();
        StaffMember member = staff.findByIdForUpdate(staffId, townshipId)
                .orElseThrow(() -> NotFoundException.of("Staff member", staffId));
        member.setActive(active);
        staff.save(member);
        audit.record(AuditAction.STAFF_ACTIVE_CHANGED, "staff_member", staffId, AuditService.detail("active", active));
        return one(member, Audience.OFFICE, null);
    }

    /** The register for one day, in the township's local time. */
    @PreAuthorize("hasRole('ADMIN')")
    @Transactional(readOnly = true)
    public List<AttendanceResponse> attendanceOn(LocalDate date) {
        LocalDate day = date == null ? clock.today() : date;
        return attendance.findByTownshipIdAndCheckedInAtGreaterThanEqualAndCheckedInAtLessThanOrderByCheckedInAtDesc(
                        TenantContext.requireTownshipId(),
                        clock.at(day, LocalTime.MIDNIGHT),
                        clock.at(day.plusDays(1), LocalTime.MIDNIGHT))
                .stream().map(StaffService::toAttendance).toList();
    }

    // ----- the gate -----------------------------------------------------------------------------

    /** Who carries this code or card. Throttled like pass redemption: a code is a key to the gate. */
    @PreAuthorize("hasRole('GUARD')")
    @Transactional(readOnly = true)
    public StaffResponse lookup(String code, UUID qrToken) {
        boolean hasCode = code != null && !code.isBlank();
        if (hasCode == (qrToken != null)) {
            throw new BusinessValidationException("CODE_OR_QR", "Give the entry code or scan the ID card.");
        }
        UUID townshipId = TenantContext.requireTownshipId();
        String limitKey = "staff:lookup:" + SecurityUtils.currentUserId();
        if (!rateLimiter.tryAcquire(limitKey, properties.security().redeem().maxAttempts(),
                Duration.ofMinutes(properties.security().redeem().windowMinutes()))) {
            log.warn("Staff lookup rate limit tripped for guard {}", SecurityUtils.currentUserId());
            throw new TooManyRequestsException("Too many attempts. Wait a moment and retry.");
        }
        Optional<StaffMember> found = hasCode
                ? staff.findByTownshipIdAndCodeLookup(townshipId, pinHasher.lookupValue(code.trim()))
                : staff.findByTownshipIdAndQrToken(townshipId, qrToken);
        StaffMember member = found.orElseThrow(() -> new NotFoundException("No staff member matches this code."));
        rateLimiter.reset(limitKey);
        return one(member, Audience.GATE, null);
    }

    @PreAuthorize("hasRole('GUARD')")
    @Transactional
    public AttendanceResponse checkIn(UUID staffId, UUID gateId) {
        UUID townshipId = TenantContext.requireTownshipId();
        StaffMember member = staff.findByIdForUpdate(staffId, townshipId)
                .orElseThrow(() -> NotFoundException.of("Staff member", staffId));
        if (!member.isActive()) {
            throw new ConflictException("STAFF_INACTIVE", member.getFullName() + " has been deactivated. Do not let them in.");
        }
        Gate gate = gate(gateId, townshipId);
        if (attendance.findFirstByStaff_IdAndCheckedOutAtIsNull(staffId).isPresent()) {
            throw new ConflictException("ALREADY_INSIDE", member.getFullName() + " is already marked inside.");
        }
        StaffAttendance stay = new StaffAttendance();
        stay.setTownshipId(townshipId);
        stay.setStaff(member);
        stay.setGate(gate);
        stay.setCheckedInAt(OffsetDateTime.now());
        stay.setLoggedBy(users.getReferenceById(SecurityUtils.currentUserId()));
        attendance.save(stay);
        audit.record(AuditAction.STAFF_CHECKED_IN, "staff_member", staffId, AuditService.detail("gateId", gateId));
        tellHouseholds(member, member.getFullName() + " has arrived", member.getCategory().label() + " · " + gate.getName());
        return toAttendance(stay);
    }

    @PreAuthorize("hasRole('GUARD')")
    @Transactional
    public AttendanceResponse checkOut(UUID staffId, UUID gateId) {
        UUID townshipId = TenantContext.requireTownshipId();
        StaffMember member = staff.findByIdForUpdate(staffId, townshipId)
                .orElseThrow(() -> NotFoundException.of("Staff member", staffId));
        Gate gate = gate(gateId, townshipId);
        StaffAttendance stay = attendance.findFirstByStaff_IdAndCheckedOutAtIsNull(staffId)
                .orElseThrow(() -> new ConflictException("NOT_INSIDE", member.getFullName() + " is not marked inside."));
        stay.setExitGate(gate);
        stay.setCheckedOutAt(OffsetDateTime.now());
        attendance.save(stay);
        audit.record(AuditAction.STAFF_CHECKED_OUT, "staff_member", staffId, AuditService.detail("gateId", gateId));
        tellHouseholds(member, member.getFullName() + " has left", member.getCategory().label() + " · " + gate.getName());
        return toAttendance(stay);
    }

    /** Staff inside right now — the guard's roll, and the office's. */
    @PreAuthorize("hasAnyRole('GUARD', 'ADMIN')")
    @Transactional(readOnly = true)
    public List<AttendanceResponse> inside() {
        return attendance.findByTownshipIdAndCheckedOutAtIsNullOrderByCheckedInAtDesc(TenantContext.requireTownshipId())
                .stream().map(StaffService::toAttendance).toList();
    }

    // ----- internals ----------------------------------------------------------------------------

    private AppUser me(UUID townshipId) {
        UUID id = SecurityUtils.currentUserId();
        return users.findByIdAndTownship_Id(id, townshipId).orElseThrow(() -> NotFoundException.of("User", id));
    }

    private static UUID requireUnit(AppUser resident) {
        if (resident.getUnit() == null) {
            throw new BusinessValidationException("NO_UNIT", "Your account is not linked to a home.");
        }
        return resident.getUnit().getId();
    }

    private void requireRoomFor(UUID unitId) {
        if (households.countByUnit_Id(unitId) >= MAX_HELPERS_PER_HOME) {
            throw new ConflictException("TOO_MANY_HELPERS",
                    "Your home already has " + MAX_HELPERS_PER_HOME + " helpers. Remove one first.");
        }
    }

    private StaffMember find(UUID staffId, UUID townshipId) {
        return staff.findByIdAndTownshipId(staffId, townshipId)
                .orElseThrow(() -> NotFoundException.of("Staff member", staffId));
    }

    private Gate gate(UUID gateId, UUID townshipId) {
        return gates.findByIdAndTownship_Id(gateId, townshipId).orElseThrow(() -> NotFoundException.of("Gate", gateId));
    }

    /** A code no one else in the township carries. Codes are per township, so collisions are rare. */
    private String freshCode(UUID townshipId) {
        for (int attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
            String code = generator.generateNumericPin(6);
            if (!staff.existsByTownshipIdAndCodeLookup(townshipId, pinHasher.lookupValue(code))) {
                return code;
            }
        }
        throw new ConflictException("CODE_SPACE_EXHAUSTED", "Could not issue a unique code. Try again.");
    }

    private StaffMember newMember(UUID townshipId, StaffScope scope, StaffCategory category, String fullName,
                                  String phone, String code, AppUser createdBy) {
        StaffMember member = new StaffMember();
        member.setTownshipId(townshipId);
        member.setScope(scope);
        member.setCategory(category);
        member.setFullName(fullName.trim());
        member.setPhone(phone);
        member.setCodeLookup(pinHasher.lookupValue(code));
        member.setQrToken(UUID.randomUUID());
        member.setCreatedBy(createdBy);
        return staff.save(member);
    }

    private void link(StaffMember member, AppUser resident) {
        StaffHousehold row = new StaffHousehold();
        row.setTownshipId(member.getTownshipId());
        row.setStaff(member);
        row.setUnit(resident.getUnit());
        row.setAddedBy(resident);
        households.save(row);
    }

    /** Daily help only: the homes they work for hear that they came or went. */
    private void tellHouseholds(StaffMember member, String title, String body) {
        if (member.getScope() != StaffScope.DAILY_HELP) {
            return;
        }
        List<UUID> unitIds = households.findByStaff_IdIn(List.of(member.getId())).stream()
                .map(h -> h.getUnit().getId()).toList();
        if (unitIds.isEmpty()) {
            return;
        }
        List<UUID> residents = users.findActiveUserIdsByUnitIds(member.getTownshipId(), unitIds);
        UUID staffId = member.getId();
        afterCommit.execute(() -> notifier.notify(residents, KIND, staffId, title, body));
    }

    private StaffResponse one(StaffMember member, Audience audience, UUID unitId) {
        return present(List.of(member), audience, unitId).get(0);
    }

    /** Builds responses for many people with a fixed number of queries, whatever the list length. */
    private List<StaffResponse> present(List<StaffMember> members, Audience audience, UUID unitId) {
        if (members.isEmpty()) {
            return List.of();
        }
        List<UUID> ids = members.stream().map(StaffMember::getId).toList();
        Map<UUID, List<String>> homes = households.findByStaff_IdIn(ids).stream().collect(Collectors.groupingBy(
                h -> h.getStaff().getId(), Collectors.mapping(h -> h.getUnit().getCode(), Collectors.toList())));
        Map<UUID, Object[]> summaries = byStaff(ratings.summaries(ids));
        Map<UUID, OffsetDateTime> lastSeen = new HashMap<>();
        attendance.lastSeen(ids).forEach(row -> lastSeen.put((UUID) row[0], (OffsetDateTime) row[1]));
        Map<UUID, OffsetDateTime> insideSince = new HashMap<>();
        attendance.findByStaff_IdInAndCheckedOutAtIsNull(ids)
                .forEach(stay -> insideSince.put(stay.getStaff().getId(), stay.getCheckedInAt()));
        Map<UUID, StaffRating> mine = unitId == null ? Map.of() : ratings.findByUnit_IdAndStaff_IdIn(unitId, ids)
                .stream().collect(Collectors.toMap(r -> r.getStaff().getId(), r -> r));

        return members.stream().map(m -> {
            List<String> units = homes.getOrDefault(m.getId(), List.of()).stream().sorted().toList();
            Object[] summary = summaries.get(m.getId());
            StaffRating my = mine.get(m.getId());
            boolean showToken = audience == Audience.OFFICE || audience == Audience.HOUSEHOLD;
            boolean showUnits = audience == Audience.OFFICE || audience == Audience.GATE;
            return new StaffResponse(
                    m.getId(), m.getScope(), m.getCategory(), m.getFullName(), m.getPhone(), m.isActive(),
                    showToken ? m.getQrToken() : null,
                    showUnits ? units : null,
                    units.size(),
                    summary == null ? null : Math.round(((Number) summary[1]).doubleValue() * 10) / 10.0,
                    summary == null ? 0 : ((Number) summary[2]).longValue(),
                    my == null ? null : my.getRating(),
                    my == null ? null : my.getReview(),
                    insideSince.containsKey(m.getId()),
                    insideSince.get(m.getId()),
                    lastSeen.get(m.getId()),
                    m.getCreatedAt());
        }).toList();
    }

    private static Map<UUID, Object[]> byStaff(Collection<Object[]> rows) {
        Map<UUID, Object[]> map = new HashMap<>();
        rows.forEach(row -> map.put((UUID) row[0], row));
        return map;
    }

    private static AttendanceResponse toAttendance(StaffAttendance a) {
        StaffMember m = a.getStaff();
        return new AttendanceResponse(a.getId(), m.getId(), m.getFullName(), m.getCategory(), m.getScope(),
                a.getGate().getName(), a.getExitGate() == null ? null : a.getExitGate().getName(),
                a.getCheckedInAt(), a.getCheckedOutAt());
    }
}
