package com.gatecrash.staff;

import com.gatecrash.staff.dto.StaffDtos.AttendanceResponse;
import com.gatecrash.staff.dto.StaffDtos.CreateStaffRequest;
import com.gatecrash.staff.dto.StaffDtos.GateLookupRequest;
import com.gatecrash.staff.dto.StaffDtos.GateMoveRequest;
import com.gatecrash.staff.dto.StaffDtos.LinkHelpRequest;
import com.gatecrash.staff.dto.StaffDtos.RateRequest;
import com.gatecrash.staff.dto.StaffDtos.RegisterHelpRequest;
import com.gatecrash.staff.dto.StaffDtos.SetActiveRequest;
import com.gatecrash.staff.dto.StaffDtos.StaffCreatedResponse;
import com.gatecrash.staff.dto.StaffDtos.StaffResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

@RestController
@RequiredArgsConstructor
@Tag(name = "Daily help & staff")
public class StaffController {

    private final StaffService staff;

    // ----- residents ----------------------------------------------------------------------------

    @GetMapping("/api/v1/staff/mine")
    @Operation(summary = "The helpers of the resident's home")
    public List<StaffResponse> mine() {
        return staff.mine();
    }

    @PostMapping("/api/v1/staff")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Resident registers a new daily helper; the entry code is returned once")
    public StaffCreatedResponse register(@Valid @RequestBody RegisterHelpRequest request) {
        return staff.register(request);
    }

    @PostMapping("/api/v1/staff/link")
    @Operation(summary = "Resident adds a helper already working in the society, by their entry code")
    public StaffResponse link(@Valid @RequestBody LinkHelpRequest request) {
        return staff.linkByCode(request.code());
    }

    @DeleteMapping("/api/v1/staff/{id}/households/mine")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "The helper no longer works for the resident's home")
    public void unlink(@PathVariable UUID id) {
        staff.unlink(id);
    }

    @PutMapping("/api/v1/staff/{id}/rating")
    @Operation(summary = "Rate a helper who works for the resident's home")
    public StaffResponse rate(@PathVariable UUID id, @Valid @RequestBody RateRequest request) {
        return staff.rate(id, request.rating(), request.review());
    }

    @GetMapping("/api/v1/staff/{id}/attendance")
    @Operation(summary = "A helper's comings and goings")
    public List<AttendanceResponse> history(@PathVariable UUID id, @RequestParam(defaultValue = "30") int days) {
        return staff.history(id, days);
    }

    @GetMapping("/api/v1/staff/directory")
    @Operation(summary = "Everyone working in the society")
    public List<StaffResponse> directory() {
        return staff.directory();
    }

    // ----- the gate -----------------------------------------------------------------------------

    @PostMapping("/api/v1/staff/gate/lookup")
    @Operation(summary = "Guard identifies a staff member by entry code or ID-card QR")
    public StaffResponse lookup(@Valid @RequestBody GateLookupRequest request) {
        return staff.lookup(request.code(), request.qrToken());
    }

    @PostMapping("/api/v1/staff/{id}/check-in")
    @Operation(summary = "Guard marks a staff member in")
    public AttendanceResponse checkIn(@PathVariable UUID id, @Valid @RequestBody GateMoveRequest request) {
        return staff.checkIn(id, request.gateId());
    }

    @PostMapping("/api/v1/staff/{id}/check-out")
    @Operation(summary = "Guard marks a staff member out")
    public AttendanceResponse checkOut(@PathVariable UUID id, @Valid @RequestBody GateMoveRequest request) {
        return staff.checkOut(id, request.gateId());
    }

    @GetMapping("/api/v1/staff/inside")
    @Operation(summary = "Staff inside right now")
    public List<AttendanceResponse> inside() {
        return staff.inside();
    }

    // ----- office -------------------------------------------------------------------------------

    @GetMapping("/api/v1/admin/staff")
    @Operation(summary = "Every staff member and helper of the township")
    public List<StaffResponse> list() {
        return staff.list();
    }

    @PostMapping("/api/v1/admin/staff")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Office adds a staff member or helper; the entry code is returned once")
    public StaffCreatedResponse create(@Valid @RequestBody CreateStaffRequest request) {
        return staff.create(request);
    }

    @PostMapping("/api/v1/admin/staff/{id}/reissue-code")
    @Operation(summary = "New entry code and ID card; the old ones stop working")
    public StaffCreatedResponse reissue(@PathVariable UUID id) {
        return staff.reissueCode(id);
    }

    @PostMapping("/api/v1/admin/staff/{id}/active")
    @Operation(summary = "Activate or deactivate a staff member")
    public StaffResponse setActive(@PathVariable UUID id, @Valid @RequestBody SetActiveRequest request) {
        return staff.setActive(id, request.active());
    }

    @GetMapping("/api/v1/admin/staff/attendance")
    @Operation(summary = "The attendance register for one day")
    public List<AttendanceResponse> attendance(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return staff.attendanceOn(date);
    }
}
