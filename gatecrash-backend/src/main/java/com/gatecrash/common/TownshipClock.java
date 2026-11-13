package com.gatecrash.common;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;

/**
 * Wall-clock time where the townships are.
 *
 * <p>Amenity hours ("6 am to 10 pm") and move dates are local times, not instants. Interpreting
 * them in the server's zone would shift every slot by however far the server is from the society.
 * One configured zone is enough while every customer is in one country; a per-township zone column
 * is the change to make when that stops being true.
 */
@Component
public class TownshipClock {

    private final ZoneId zone;

    public TownshipClock(@Value("${app.time-zone:Asia/Kolkata}") String zone) {
        this.zone = ZoneId.of(zone);
    }

    public ZoneId zone() {
        return zone;
    }

    public LocalDate today() {
        return LocalDate.now(zone);
    }

    public OffsetDateTime at(LocalDate date, LocalTime time) {
        return date.atTime(time).atZone(zone).toOffsetDateTime();
    }
}
