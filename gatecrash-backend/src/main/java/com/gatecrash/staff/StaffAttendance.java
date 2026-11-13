package com.gatecrash.staff;

import com.gatecrash.township.Gate;
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
import org.hibernate.annotations.UuidGenerator;

import java.time.OffsetDateTime;
import java.util.UUID;

/** One stay inside: marked in at a gate, marked out (possibly at another). This is attendance. */
@Entity
@Table(name = "staff_attendance")
@Getter
@Setter
@NoArgsConstructor
public class StaffAttendance {

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
    @JoinColumn(name = "gate_id", nullable = false, updatable = false)
    private Gate gate;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "exit_gate_id")
    private Gate exitGate;

    @Column(name = "checked_in_at", nullable = false, updatable = false)
    private OffsetDateTime checkedInAt;

    @Column(name = "checked_out_at")
    private OffsetDateTime checkedOutAt;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "logged_by", updatable = false)
    private AppUser loggedBy;
}
