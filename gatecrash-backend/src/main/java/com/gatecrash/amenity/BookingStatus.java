package com.gatecrash.amenity;

/** Maps 1:1 to the Postgres {@code booking_status} enum (V8). Bookings confirm instantly. */
public enum BookingStatus {
    CONFIRMED,
    CANCELLED
}
