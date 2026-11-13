package com.gatecrash.user;

import com.gatecrash.property.PropertyNode;
import com.gatecrash.user.dto.UserDtos.SalesAgentResponse;
import com.gatecrash.user.dto.UserDtos.UserResponse;
import org.springframework.stereotype.Component;

/**
 * Entity to DTO translation.
 *
 * <p>Written by hand rather than generated: these mappings are few, and every one of them is a place
 * where {@code passwordHash} or {@code tokenVersion} could accidentally escape over HTTP. Being able
 * to read exactly which fields cross the boundary is worth more here than the saved keystrokes.
 */
@Component
public class UserMapper {

    public UserResponse toResponse(AppUser user) {
        PropertyNode unit = user.getUnit();
        return new UserResponse(
                user.getId(),
                user.getLoginId(),
                user.getTownshipId(),
                user.getFullName(),
                user.getRole(),
                user.isSales(),
                user.getPhone(),
                user.getEmail(),
                user.isActive(),
                user.isMustResetPassword(),
                user.isOnDuty(),
                unit == null ? null : unit.getId(),
                unit == null ? null : unit.getCode(),
                unit == null ? null : unit.containerName(),
                user.getCreatedAt());
    }

    public SalesAgentResponse toSalesAgent(AppUser user) {
        return new SalesAgentResponse(user.getId(), user.getFullName(), user.getLoginId());
    }
}
