package com.gatecrash.user;

import com.gatecrash.user.dto.UserDtos.DutyRequest;
import com.gatecrash.user.dto.UserDtos.SalesAgentResponse;
import com.gatecrash.user.dto.UserDtos.UserResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** Sales presence: the toggle an agent flips, and the list the guard reads. */
@RestController
@RequestMapping("/api/v1/sales")
@RequiredArgsConstructor
@Tag(name = "Sales duty")
public class SalesController {

    private final UserService userService;

    @PatchMapping("/me/duty")
    @Operation(summary = "Sales agent marks themselves on or off duty")
    public UserResponse setDuty(@Valid @RequestBody DutyRequest request) {
        return userService.setOwnDuty(request.onDuty());
    }

    @GetMapping("/on-duty")
    @Operation(summary = "On-duty sales agents, for the guard's routing dropdown")
    public List<SalesAgentResponse> onDuty() {
        return userService.onDutySalesAgents();
    }
}
