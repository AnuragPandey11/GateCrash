package com.gatecrash.amenity;

import com.gatecrash.property.PropertyNode;
import com.gatecrash.user.AppUser;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UuidGenerator;
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(name = "amenity_booking")
@Getter
@Setter
@NoArgsConstructor
public class AmenityBooking {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "township_id", nullable = false, updatable = false)
    private UUID townshipId;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "amenity_id", nullable = false, updatable = false)
    private Amenity amenity;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "booked_by", nullable = false, updatable = false)
    private AppUser bookedBy;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "unit_id", updatable = false)
    private PropertyNode unit;

    @Column(name = "starts_at", nullable = false, updatable = false)
    private OffsetDateTime startsAt;

    @Column(name = "ends_at", nullable = false, updatable = false)
    private OffsetDateTime endsAt;

    @Column(name = "guests", nullable = false)
    private int guests = 1;

    @Column(name = "note")
    private String note;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    @Column(name = "status", nullable = false, columnDefinition = "booking_status")
    private BookingStatus status = BookingStatus.CONFIRMED;

    @Column(name = "cancel_reason")
    private String cancelReason;

    @Column(name = "cancelled_at")
    private OffsetDateTime cancelledAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;
}
