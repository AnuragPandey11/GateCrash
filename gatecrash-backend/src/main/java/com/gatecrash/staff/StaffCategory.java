package com.gatecrash.staff;

import java.util.Locale;

/** What a staff member does. Display only — nothing branches on it. */
public enum StaffCategory {
    MAID, COOK, DRIVER, NANNY, CAR_CLEANER, GARDENER, ELDER_CARE, LAUNDRY,
    HOUSEKEEPING, SECURITY, ELECTRICIAN, PLUMBER, MAINTENANCE, OFFICE, OTHER;

    /** "CAR_CLEANER" → "Car cleaner", for notification text. */
    public String label() {
        String words = name().replace('_', ' ').toLowerCase(Locale.ROOT);
        return Character.toUpperCase(words.charAt(0)) + words.substring(1);
    }
}
