package com.gatecrash.security;

import com.gatecrash.user.AppUserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
@RequiredArgsConstructor
public class AppUserDetailsService implements UserDetailsService {

    private final AppUserRepository users;

    /**
     * {@code username} is the {@code login_id}. The failure message is intentionally constant so it
     * cannot be used to enumerate which login ids exist.
     */
    @Override
    @Transactional(readOnly = true)
    public AppUserDetails loadUserByUsername(String loginId) throws UsernameNotFoundException {
        return users.findByLoginId(loginId)
                .map(AppUserDetails::from)
                .orElseThrow(() -> new UsernameNotFoundException("Invalid credentials"));
    }

    /** Used on the bearer-token path, where the subject claim is the authoritative identity. */
    @Transactional(readOnly = true)
    public AppUserDetails loadById(UUID id) throws UsernameNotFoundException {
        return users.findById(id)
                .map(AppUserDetails::from)
                .orElseThrow(() -> new UsernameNotFoundException("Invalid credentials"));
    }
}
