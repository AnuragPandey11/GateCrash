package com.gatecrash.amenity;

import com.gatecrash.amenity.dto.AmenityDtos.AmenityRequest;
import com.gatecrash.amenity.dto.AmenityDtos.AmenityResponse;
import com.gatecrash.amenity.dto.AmenityDtos.AvailabilityResponse;
import com.gatecrash.amenity.dto.AmenityDtos.BookRequest;
import com.gatecrash.amenity.dto.AmenityDtos.BookingResponse;
import com.gatecrash.amenity.dto.AmenityDtos.SlotResponse;
import com.gatecrash.common.AfterCommitExecutor;
import com.gatecrash.common.TownshipClock;
import com.gatecrash.common.audit.AuditAction;
import com.gatecrash.common.audit.AuditService;
import com.gatecrash.common.exception.BusinessValidationException;
import com.gatecrash.common.exception.ConflictException;
import com.gatecrash.common.exception.ForbiddenException;
import com.gatecrash.common.exception.NotFoundException;
import com.gatecrash.common.tenant.TenantContext;
import com.gatecrash.push.UserNotifier;
import com.gatecrash.security.SecurityUtils;
import com.gatecrash.user.AppUser;
import com.gatecrash.user.AppUserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Amenities and their bookings.
 *
 * <p>Bookings confirm instantly when the slot has room -- the office's power is to cancel, with a
 * reason the resident is told. Room is checked under a row lock on the amenity, so two residents
 * racing for a court's last slot cannot both win it.
 */
@Service
@RequiredArgsConstructor
public class AmenityService {

    public static final String KIND = "BOOKING";

    /** How far ahead a slot may be booked. */
    private static final int BOOKING_HORIZON_DAYS = 30;

    private final AmenityRepository amenities;
    private final AmenityBookingRepository bookings;
    private final AppUserRepository users;
    private final TownshipClock clock;
    private final AuditService audit;
    private final UserNotifier notifier;
    private final AfterCommitExecutor afterCommit;

    // ----- catalogue ----------------------------------------------------------------------------

    /** Residents see what they can book; the office also sees what it has switched off. */
    @PreAuthorize("hasAnyRole('ADMIN','RESIDENT')")
    @Transactional(readOnly = true)
    public List<AmenityResponse> list() {
        UUID townshipId = TenantContext.requireTownshipId();
        List<Amenity> rows = SecurityUtils.currentRole().isAdministrative()
                ? amenities.findByTownshipIdOrderByNameAsc(townshipId)
                : amenities.findByTownshipIdAndActiveTrueOrderByNameAsc(townshipId);
        return rows.stream().map(this::toResponse).toList();
    }

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public AmenityResponse create(AmenityRequest request) {
        UUID townshipId = TenantContext.requireTownshipId();
        String name = request.name().trim();
        if (amenities.existsByTownshipIdAndNameIgnoreCase(townshipId, name)) {
            throw new ConflictException("AMENITY_EXISTS", "An amenity with that name already exists.");
        }
        Amenity amenity = new Amenity();
        amenity.setTownshipId(townshipId);
        apply(amenity, request, name);
        amenities.save(amenity);
        audit.record(AuditAction.AMENITY_CREATED, "amenity", amenity.getId(), AuditService.detail("name", name));
        return toResponse(amenity);
    }

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public AmenityResponse update(UUID amenityId, AmenityRequest request) {
        UUID townshipId = TenantContext.requireTownshipId();
        Amenity amenity = amenities.findByIdAndTownshipId(amenityId, townshipId)
                .orElseThrow(() -> NotFoundException.of("Amenity", amenityId));
        String name = request.name().trim();
        if (amenities.existsByTownshipIdAndNameIgnoreCaseAndIdNot(townshipId, name, amenityId)) {
            throw new ConflictException("AMENITY_EXISTS", "An amenity with that name already exists.");
        }
        apply(amenity, request, name);
        amenities.save(amenity);
        audit.record(AuditAction.AMENITY_UPDATED, "amenity", amenityId, null);
        return toResponse(amenity);
    }

    // ----- availability and booking -------------------------------------------------------------

    @PreAuthorize("hasAnyRole('ADMIN','RESIDENT')")
    @Transactional(readOnly = true)
    public AvailabilityResponse availability(UUID amenityId, LocalDate date) {
        Amenity amenity = amenities.findByIdAndTownshipId(amenityId, TenantContext.requireTownshipId())
                .orElseThrow(() -> NotFoundException.of("Amenity", amenityId));
        UUID me = SecurityUtils.currentUserId();
        OffsetDateTime now = OffsetDateTime.now();

        OffsetDateTime dayStart = clock.at(date, amenity.getOpenTime());
        OffsetDateTime dayEnd = clock.at(date, amenity.getCloseTime());
        List<AmenityBooking> taken = bookings.findConfirmedOverlapping(amenityId, dayStart, dayEnd);

        List<SlotResponse> slots = new ArrayList<>();
        for (LocalTime t = amenity.getOpenTime();
             !t.plusMinutes(amenity.getSlotMinutes()).isAfter(amenity.getCloseTime())
                     && t.plusMinutes(amenity.getSlotMinutes()).isAfter(t);
             t = t.plusMinutes(amenity.getSlotMinutes())) {
            LocalTime end = t.plusMinutes(amenity.getSlotMinutes());
            OffsetDateTime from = clock.at(date, t);
            OffsetDateTime to = clock.at(date, end);
            int booked = 0;
            boolean mine = false;
            for (AmenityBooking b : taken) {
                if (b.getStartsAt().isBefore(to) && b.getEndsAt().isAfter(from)) {
                    booked++;
                    mine |= b.getBookedBy().getId().equals(me);
                }
            }
            boolean past = !from.isAfter(now);
            slots.add(new SlotResponse(t, end, from, to, booked, amenity.getCapacity(),
                    !past && booked < amenity.getCapacity() && amenity.isActive(), mine, past));
        }
        return new AvailabilityResponse(amenityId, date, slots);
    }

    @PreAuthorize("hasRole('RESIDENT')")
    @Transactional
    public BookingResponse book(BookRequest request) {
        UUID townshipId = TenantContext.requireTownshipId();
        Amenity amenity = amenities.findByIdForUpdate(request.amenityId(), townshipId)
                .orElseThrow(() -> NotFoundException.of("Amenity", request.amenityId()));
        if (!amenity.isActive()) {
            throw new ConflictException("AMENITY_INACTIVE", "This amenity is not taking bookings.");
        }
        LocalDate today = clock.today();
        if (request.date().isBefore(today) || request.date().isAfter(today.plusDays(BOOKING_HORIZON_DAYS))) {
            throw new BusinessValidationException("OUTSIDE_BOOKING_WINDOW",
                    "Bookings open up to " + BOOKING_HORIZON_DAYS + " days ahead.");
        }
        if (request.slots() > amenity.getMaxSlotsPerBooking()) {
            throw new BusinessValidationException("TOO_MANY_SLOTS",
                    "At most " + amenity.getMaxSlotsPerBooking() + " consecutive slots per booking.");
        }
        long offset = Duration.between(amenity.getOpenTime(), request.startTime()).toMinutes();
        LocalTime endTime = request.startTime().plusMinutes((long) amenity.getSlotMinutes() * request.slots());
        if (offset < 0 || offset % amenity.getSlotMinutes() != 0
                || endTime.isAfter(amenity.getCloseTime()) || !endTime.isAfter(request.startTime())) {
            throw new BusinessValidationException("INVALID_SLOT", "Pick a slot within the opening hours.");
        }
        OffsetDateTime startsAt = clock.at(request.date(), request.startTime());
        OffsetDateTime endsAt = clock.at(request.date(), endTime);
        if (!startsAt.isAfter(OffsetDateTime.now())) {
            throw new BusinessValidationException("INVALID_SLOT", "That slot has already started.");
        }

        // Every slot in the range must have room, and the resident may not hold an overlapping
        // booking of the same amenity already.
        UUID me = SecurityUtils.currentUserId();
        List<AmenityBooking> overlapping = bookings.findConfirmedOverlapping(amenity.getId(), startsAt, endsAt);
        if (overlapping.stream().anyMatch(b -> b.getBookedBy().getId().equals(me))) {
            throw new ConflictException("ALREADY_BOOKED", "You already have a booking at this time.");
        }
        for (int i = 0; i < request.slots(); i++) {
            OffsetDateTime from = startsAt.plusMinutes((long) i * amenity.getSlotMinutes());
            OffsetDateTime to = from.plusMinutes(amenity.getSlotMinutes());
            long booked = overlapping.stream()
                    .filter(b -> b.getStartsAt().isBefore(to) && b.getEndsAt().isAfter(from)).count();
            if (booked >= amenity.getCapacity()) {
                throw new ConflictException("SLOT_FULL", "That slot has just been taken. Pick another.");
            }
        }

        AppUser resident = users.findByIdAndTownship_Id(me, townshipId)
                .orElseThrow(() -> NotFoundException.of("User", me));
        AmenityBooking booking = new AmenityBooking();
        booking.setTownshipId(townshipId);
        booking.setAmenity(amenity);
        booking.setBookedBy(resident);
        booking.setUnit(resident.getUnit());
        booking.setStartsAt(startsAt);
        booking.setEndsAt(endsAt);
        booking.setGuests(request.guests() == null ? 1 : request.guests());
        booking.setNote(blankToNull(request.note()));
        bookings.save(booking);
        audit.record(AuditAction.BOOKING_CREATED, "amenity_booking", booking.getId(),
                AuditService.detail("amenityId", amenity.getId(), "startsAt", startsAt.toString()));
        return toResponse(booking);
    }

    @PreAuthorize("hasRole('RESIDENT')")
    @Transactional(readOnly = true)
    public List<BookingResponse> mine() {
        return bookings.findTop50ByTownshipIdAndBookedBy_IdOrderByStartsAtDesc(
                        TenantContext.requireTownshipId(), SecurityUtils.currentUserId())
                .stream().map(this::toResponse).toList();
    }

    /** A resident cancels their own upcoming booking; the office cancels any, and says why. */
    @PreAuthorize("hasAnyRole('ADMIN','RESIDENT')")
    @Transactional
    public BookingResponse cancel(UUID bookingId, String reason) {
        AmenityBooking booking = bookings.findByIdAndTownshipId(bookingId, TenantContext.requireTownshipId())
                .orElseThrow(() -> NotFoundException.of("Booking", bookingId));
        boolean office = SecurityUtils.currentRole().isAdministrative();
        if (!office && !booking.getBookedBy().getId().equals(SecurityUtils.currentUserId())) {
            throw new ForbiddenException("This is not your booking.");
        }
        if (booking.getStatus() == BookingStatus.CANCELLED) {
            throw new ConflictException("ALREADY_CANCELLED", "This booking is already cancelled.");
        }
        if (!office && !booking.getStartsAt().isAfter(OffsetDateTime.now())) {
            throw new ConflictException("BOOKING_STARTED", "A booking that has started cannot be cancelled.");
        }
        if (office && (reason == null || reason.isBlank())) {
            throw new BusinessValidationException("REASON_REQUIRED", "Tell the resident why it is cancelled.");
        }
        booking.setStatus(BookingStatus.CANCELLED);
        booking.setCancelledAt(OffsetDateTime.now());
        booking.setCancelReason(blankToNull(reason));
        bookings.save(booking);
        audit.record(AuditAction.BOOKING_CANCELLED, "amenity_booking", bookingId,
                AuditService.detail("byOffice", office));

        if (office) {
            UUID residentId = booking.getBookedBy().getId();
            String title = booking.getAmenity().getName() + " booking cancelled";
            String body = booking.getCancelReason();
            afterCommit.execute(() -> notifier.notify(List.of(residentId), KIND, bookingId, title, body));
        }
        return toResponse(booking);
    }

    /** The office's day view: every booking touching {@code date}, across all amenities. */
    @PreAuthorize("hasRole('ADMIN')")
    @Transactional(readOnly = true)
    public List<BookingResponse> forDay(LocalDate date) {
        return bookings.findForWindow(TenantContext.requireTownshipId(),
                        clock.at(date, LocalTime.MIN), clock.at(date.plusDays(1), LocalTime.MIN))
                .stream().map(this::toResponse).toList();
    }

    // ----- internals ----------------------------------------------------------------------------

    private void apply(Amenity amenity, AmenityRequest request, String name) {
        if (!request.closeTime().isAfter(request.openTime())) {
            throw new BusinessValidationException("INVALID_HOURS", "Closing time must be after opening time.");
        }
        if (Duration.between(request.openTime(), request.closeTime()).toMinutes() < request.slotMinutes()) {
            throw new BusinessValidationException("INVALID_HOURS", "The opening hours are shorter than one slot.");
        }
        amenity.setName(name);
        amenity.setDescription(blankToNull(request.description()));
        amenity.setCapacity(request.capacity());
        amenity.setOpenTime(request.openTime());
        amenity.setCloseTime(request.closeTime());
        amenity.setSlotMinutes(request.slotMinutes());
        amenity.setMaxSlotsPerBooking(request.maxSlotsPerBooking());
        amenity.setActive(request.active() == null || request.active());
    }

    private AmenityResponse toResponse(Amenity a) {
        return new AmenityResponse(a.getId(), a.getName(), a.getDescription(), a.getCapacity(),
                a.getOpenTime(), a.getCloseTime(), a.getSlotMinutes(), a.getMaxSlotsPerBooking(), a.isActive());
    }

    private BookingResponse toResponse(AmenityBooking b) {
        return new BookingResponse(b.getId(), b.getAmenity().getId(), b.getAmenity().getName(),
                b.getBookedBy().getFullName(), b.getUnit() == null ? null : b.getUnit().getCode(),
                b.getStartsAt(), b.getEndsAt(), b.getGuests(), b.getNote(), b.getStatus(),
                b.getCancelReason(), b.getCreatedAt());
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
