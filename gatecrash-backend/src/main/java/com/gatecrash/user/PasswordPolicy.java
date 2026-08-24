package com.gatecrash.user;

import com.gatecrash.common.exception.BusinessValidationException;
import com.gatecrash.config.AppProperties;
import org.springframework.stereotype.Component;

import java.util.Locale;
import java.util.Set;

/**
 * The rules a user-chosen password must satisfy.
 *
 * <p>Length does most of the work, so the minimum is 10 rather than the customary 8, and the upper
 * bound is real: bcrypt silently truncates at 72 bytes, and accepting megabyte passwords is a cheap
 * way to burn server CPU. The character-class rule is deliberately "3 of 4" rather than "all 4",
 * which pushes users towards longer passphrases instead of {@code Password1!}.
 */
@Component
public class PasswordPolicy {

    /** Not a serious dictionary -- just the handful that show up when someone is forced to change. */
    private static final Set<String> BLOCKED = Set.of(
            "password", "password1", "password123", "welcome1", "letmein123", "qwerty123",
            "changeme", "changeme123", "admin123", "gatecrash", "gatecrash123", "12345678910");

    private final int minLength;
    private final int maxLength;

    public PasswordPolicy(AppProperties properties) {
        this.minLength = properties.password().minLength();
        this.maxLength = properties.password().maxLength();
    }

    public void validate(String password, String loginId, String fullName) {
        if (password == null || password.isBlank()) {
            throw new BusinessValidationException("WEAK_PASSWORD", "Password must not be blank.");
        }
        if (password.length() < minLength) {
            throw new BusinessValidationException("WEAK_PASSWORD",
                    "Password must be at least " + minLength + " characters.");
        }
        if (password.length() > maxLength) {
            throw new BusinessValidationException("WEAK_PASSWORD",
                    "Password must be at most " + maxLength + " characters.");
        }

        int classes = 0;
        if (password.chars().anyMatch(Character::isUpperCase)) classes++;
        if (password.chars().anyMatch(Character::isLowerCase)) classes++;
        if (password.chars().anyMatch(Character::isDigit)) classes++;
        if (password.chars().anyMatch(character -> !Character.isLetterOrDigit(character))) classes++;
        if (classes < 3) {
            throw new BusinessValidationException("WEAK_PASSWORD",
                    "Password must combine at least three of: uppercase, lowercase, digits, symbols.");
        }

        String lower = password.toLowerCase(Locale.ROOT);
        if (BLOCKED.contains(lower)) {
            throw new BusinessValidationException("WEAK_PASSWORD", "That password is too common.");
        }
        if (loginId != null && !loginId.isBlank() && lower.contains(loginId.toLowerCase(Locale.ROOT))) {
            throw new BusinessValidationException("WEAK_PASSWORD",
                    "Password must not contain your login id.");
        }
        if (fullName != null) {
            for (String part : fullName.toLowerCase(Locale.ROOT).split("\\s+")) {
                if (part.length() >= 4 && lower.contains(part)) {
                    throw new BusinessValidationException("WEAK_PASSWORD",
                            "Password must not contain your name.");
                }
            }
        }
    }
}
