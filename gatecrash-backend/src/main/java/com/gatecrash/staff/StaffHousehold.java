package com.gatecrash.staff;

import com.gatecrash.property.PropertyNode;
import com.gatecrash.user.AppUser;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UuidGenerator;

import java.time.OffsetDateTime;
import java.util.UUID;

/** A home a daily helper works for. */
@Entity
@Table(name = "staff_household")
@Getter
@Setter
@NoArgsConstructor
public class StaffHousehold {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "township_id", nullable = false, updatable = false)
    private UUID townshipId;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "staff_id", nullable = false, updatable = false)
    private StaffMember staff;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "unit_id", nullable = false, updatable = false)
    private PropertyNode unit;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "added_by", updatable = false)
    private AppUser addedBy;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;
}
