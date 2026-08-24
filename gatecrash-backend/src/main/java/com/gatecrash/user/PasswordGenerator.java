package com.gatecrash.user;

import com.gatecrash.config.AppProperties;
import org.springframework.stereotype.Component;

import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.List;

/**
 * Generates the passwords handed to newly provisioned accounts, and the PINs behind visitor passes.
 *
 * <p>Two properties matter and pull against each other: the value must be unguessable, and a human
 * has to read it off a screen and type it on a phone keypad. The alphabet therefore drops every
 * character pair that is routinely misread ({@code O/0}, {@code l/1/I}) while staying large enough
 * that a 12-character password carries roughly 68 bits of entropy.
 *
 * <p>{@link SecureRandom} throughout -- never {@code Math.random()} or a seeded {@code Random}, and
 * {@code nextInt(bound)} rather than a modulo, which would bias the low end of the alphabet.
 */
@Component
public class PasswordGenerator {

    private static final String UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";   // no I, O
    private static final String LOWER = "abcdefghijkmnopqrstuvwxyz";  // no l
    private static final String DIGITS = "23456789";                  // no 0, 1
    private static final String ALPHABET = UPPER + LOWER + DIGITS;

    private final SecureRandom random = new SecureRandom();
    private final int defaultLength;

    public PasswordGenerator(AppProperties properties) {
        this.defaultLength = properties.password().generatedLength();
    }

    public String generate() {
        return generate(defaultLength);
    }

    /**
     * Guarantees at least one character from each class, then shuffles, so the result always passes
     * a downstream complexity check without the caller having to retry.
     */
    public String generate(int length) {
        if (length < 8) {
            throw new IllegalArgumentException("Generated passwords must be at least 8 characters");
        }
        List<Character> characters = new ArrayList<>(length);
        characters.add(pick(UPPER));
        characters.add(pick(LOWER));
        characters.add(pick(DIGITS));
        for (int i = characters.size(); i < length; i++) {
            characters.add(pick(ALPHABET));
        }
        // Fisher-Yates, so the guaranteed characters are not pinned to the first three positions.
        for (int i = characters.size() - 1; i > 0; i--) {
            int j = random.nextInt(i + 1);
            characters.set(i, characters.set(j, characters.get(i)));
        }
        StringBuilder builder = new StringBuilder(length);
        characters.forEach(builder::append);
        return builder.toString();
    }

    /** Numeric PIN for a visitor pass, zero-padded to a fixed width so it is always {@code length} digits. */
    public String generateNumericPin(int length) {
        if (length < 4 || length > 10) {
            throw new IllegalArgumentException("PIN length must be between 4 and 10");
        }
        StringBuilder builder = new StringBuilder(length);
        for (int i = 0; i < length; i++) {
            builder.append(random.nextInt(10));
        }
        return builder.toString();
    }

    private char pick(String alphabet) {
        return alphabet.charAt(random.nextInt(alphabet.length()));
    }
}
