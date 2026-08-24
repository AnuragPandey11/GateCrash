package com.gatecrash.pass;

import com.gatecrash.config.AppProperties;
import org.springframework.stereotype.Component;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.Base64;

/**
 * Derives the deterministic lookup index for a pass PIN.
 *
 * <p>Why this exists: a 6-digit PIN has to be found in the table before it can be verified, but
 * bcrypt is salted, so it cannot be queried. The naive alternative -- load every ACTIVE pass and
 * bcrypt-compare each one -- is O(n) bcrypt operations per gate entry, which is both slow at a busy
 * gate and a trivial denial-of-service vector.
 *
 * <p>So the PIN is also stored as HMAC-SHA256 under a server-side pepper, and that value is indexed.
 * Two properties make this safe:
 * <ul>
 *   <li>The pepper lives in configuration, never in the database. A stolen dump gives an attacker a
 *       column of HMACs with no key -- and a 6-digit keyspace they cannot enumerate offline without
 *       it.</li>
 *   <li>The HMAC is only ever used to <em>find</em> candidate rows. Authorisation still rests on the
 *       bcrypt comparison, so a hash collision or a corrupted index cannot admit anyone.</li>
 * </ul>
 */
@Component
public class PinHasher {

    private static final String ALGORITHM = "HmacSHA256";
    private static final int MIN_PEPPER_BYTES = 16;

    private final SecretKeySpec key;

    public PinHasher(AppProperties properties) {
        byte[] pepper = properties.pass().pinPepper().getBytes(StandardCharsets.UTF_8);
        if (pepper.length < MIN_PEPPER_BYTES) {
            throw new IllegalStateException(
                    "app.pass.pin-pepper must be at least " + MIN_PEPPER_BYTES + " bytes");
        }
        this.key = new SecretKeySpec(pepper, ALGORITHM);
    }

    public String lookupValue(String pin) {
        try {
            Mac mac = Mac.getInstance(ALGORITHM);
            mac.init(key);
            byte[] digest = mac.doFinal(pin.getBytes(StandardCharsets.UTF_8));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
        } catch (GeneralSecurityException ex) {
            throw new IllegalStateException("Unable to compute PIN lookup value", ex);
        }
    }
}
