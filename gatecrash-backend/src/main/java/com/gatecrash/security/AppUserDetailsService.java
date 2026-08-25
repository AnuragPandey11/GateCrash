package com.gatecrash.security;

import com.gatecrash.user.AppUserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * Loads the principal behind a bearer token.
 *
 * <p>Notably <em>not</em> a Spring {@code UserDetailsService}. That contract resolves an account from
 * a username alone, and since login ids became unique only within a township there is no longer such
 * a thing as "the account with login id {@code A-101-1}" -- every township with a block A has one.
 * Implementing the interface would mean either picking one arbitrarily or querying across tenants,
 * and both are exactly the bug multi-tenancy is supposed to make impossible. Login resolves
 * {@code (townshipCode, loginId)} in {@code AuthService}; everything after that resolves by id.
 */
@Service
@RequiredArgsConstructor
public class AppUserDetailsService {

    private final AppUserRepository users;

    /**
     * The subject claim is the authoritative identity on the bearer-token path.
     *
     * <p>Runs in a transaction so the lazily mapped township can be read while building the
     * principal -- the account's tenant and its status are part of every authorization decision.
     */
    @Transactional(readOnly = true)
    public AppUserDetails loadById(UUID id) throws UsernameNotFoundException {
        return users.findById(id)
                .map(AppUserDetails::from)
                .orElseThrow(() -> new UsernameNotFoundException("Invalid credentials"));
    }
}
