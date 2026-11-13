package com.gatecrash.amenity;

import com.gatecrash.amenity.dto.AmenityDtos.AmenityRequest;
import com.gatecrash.amenity.dto.AmenityDtos.AmenityResponse;
import com.gatecrash.amenity.dto.AmenityDtos.AvailabilityResponse;
import com.gatecrash.amenity.dto.AmenityDtos.BookRequest;
import com.gatecrash.amenity.dto.AmenityDtos.BookingResponse;
import com.gatecrash.amenity.dto.AmenityDtos.CancelRequest;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
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
@Tag(name = "Amenities")
public class AmenityController {

    private final AmenityService amenities;

    @GetMapping("/api/v1/amenities")
    @Operation(summary = "Amenities: active ones for residents, all for the office")
    public List<AmenityResponse> list() {
        return amenities.list();
    }

    @GetMapping("/api/v1/amenities/{id}/availability")
    @Operation(summary = "One day's slots for an amenity, with how full each is")
    public AvailabilityResponse availability(
            @PathVariable UUID id,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return amenities.availability(id, date);
    }

    @PostMapping("/api/v1/amenity-bookings")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Resident books consecutive slots; confirmed instantly if there is room")
    public BookingResponse book(@Valid @RequestBody BookRequest request) {
        return amenities.book(request);
    }

    @GetMapping("/api/v1/amenity-bookings/mine")
    @Operation(summary = "The resident's bookings, newest first")
    public List<BookingResponse> mine() {
        return amenities.mine();
    }

    @PostMapping("/api/v1/amenity-bookings/{id}/cancel")
    @Operation(summary = "Cancel a booking: the resident their own, the office any (with a reason)")
    public BookingResponse cancel(@PathVariable UUID id, @Valid @RequestBody(required = false) CancelRequest request) {
        return amenities.cancel(id, request == null ? null : request.reason());
    }

    @PostMapping("/api/v1/admin/amenities")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Office adds an amenity")
    public AmenityResponse create(@Valid @RequestBody AmenityRequest request) {
        return amenities.create(request);
    }

    @PutMapping("/api/v1/admin/amenities/{id}")
    @Operation(summary = "Office edits an amenity, including switching it off")
    public AmenityResponse update(@PathVariable UUID id, @Valid @RequestBody AmenityRequest request) {
        return amenities.update(id, request);
    }

    @GetMapping("/api/v1/admin/amenity-bookings")
    @Operation(summary = "Every booking on one day")
    public List<BookingResponse> forDay(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return amenities.forDay(date);
    }
}
