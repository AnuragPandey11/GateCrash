package com.gatecrash.amenity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.annotations.UuidGenerator;

import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * A bookable facility -- clubhouse, badminton court, guest room. Open hours are local wall-clock
 * times, split into fixed slots; {@code capacity} is how many bookings may share one slot (one for
 * a court, twenty for a gym).
 */
@Entity
@Table(name = "amenity")
@Getter
@Setter
@NoArgsConstructor
public class Amenity {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "township_id", nullable = false, updatable = false)
    private UUID townshipId;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "description")
    private String description;

    @Column(name = "capacity", nullable = false)
    private int capacity;

    @Column(name = "open_time", nullable = false)
    private LocalTime openTime;

    @Column(name = "close_time", nullable = false)
    private LocalTime closeTime;

    @Column(name = "slot_minutes", nullable = false)
    private int slotMinutes;

    @Column(name = "max_slots_per_booking", nullable = false)
    private int maxSlotsPerBooking = 2;

    @Column(name = "active", nullable = false)
    private boolean active = true;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;
}
