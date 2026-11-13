package com.gatecrash.amenity;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface AmenityBookingRepository extends JpaRepository<AmenityBooking, UUID> {

    Optional<AmenityBooking> findByIdAndTownshipId(UUID id, UUID townshipId);

    /** Confirmed bookings overlapping [from, to) -- the input to a slot's remaining capacity. */
    @Query("""
           select b from AmenityBooking b
            where b.amenity.id = :amenityId
              and b.status = :confirmed
              and b.startsAt < :to and b.endsAt > :from
           """)
    List<AmenityBooking> findOverlapping(@Param("amenityId") UUID amenityId,
                                         @Param("confirmed") BookingStatus confirmed,
                                         @Param("from") OffsetDateTime from,
                                         @Param("to") OffsetDateTime to);

    default List<AmenityBooking> findConfirmedOverlapping(UUID amenityId, OffsetDateTime from,
                                                          OffsetDateTime to) {
        return findOverlapping(amenityId, BookingStatus.CONFIRMED, from, to);
    }

    List<AmenityBooking> findTop50ByTownshipIdAndBookedBy_IdOrderByStartsAtDesc(UUID townshipId, UUID userId);

    /** Every booking (any status) touching one local day, for the office's day view. */
    @Query("""
           select b from AmenityBooking b
            where b.townshipId = :townshipId
              and b.startsAt < :to and b.endsAt > :from
            order by b.startsAt asc
           """)
    List<AmenityBooking> findForWindow(@Param("townshipId") UUID townshipId,
                                       @Param("from") OffsetDateTime from,
                                       @Param("to") OffsetDateTime to);
}
