package com.gatecrash.user;

import com.gatecrash.common.ClientAddressResolver;
import com.gatecrash.user.dto.AuthDtos.ChangePasswordRequest;
import com.gatecrash.user.dto.AuthDtos.LoginRequest;
import com.gatecrash.user.dto.AuthDtos.LoginResponse;
import com.gatecrash.user.dto.AuthDtos.LogoutRequest;
import com.gatecrash.user.dto.AuthDtos.MeResponse;
import com.gatecrash.user.dto.AuthDtos.RefreshRequest;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth")
@RequiredArgsConstructor
@Tag(name = "Authentication")
public class AuthController {

    private final AuthService auth;

    @PostMapping("/login")
    @Operation(summary = "Exchange login id and password for an access/refresh token pair")
    public LoginResponse login(@Valid @RequestBody LoginRequest request, HttpServletRequest servletRequest) {
        return auth.login(request, ClientAddressResolver.resolve(servletRequest));
    }

    @PostMapping("/refresh")
    @Operation(summary = "Rotate a refresh token for a new pair")
    public LoginResponse refresh(@Valid @RequestBody RefreshRequest request) {
        return auth.refresh(request.refreshToken());
    }

    @PostMapping("/password")
    @Operation(summary = "Change own password; clears the forced-reset flag and ends other sessions")
    public LoginResponse changePassword(@Valid @RequestBody ChangePasswordRequest request) {
        return auth.changePassword(request);
    }

    @PostMapping("/logout")
    @Operation(summary = "Revoke the supplied refresh token, or all sessions when none is given")
    public ResponseEntity<Void> logout(@Valid @RequestBody(required = false) LogoutRequest request) {
        auth.logout(request == null ? null : request.refreshToken());
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/me")
    @Operation(summary = "Current principal, for client session rehydration")
    public MeResponse me() {
        return auth.me();
    }
}
