import math

stiffness = 470.0
friction = 70.0
mass = 3.0
omega = math.sqrt(stiffness / mass)
zeta = friction / (2.0 * math.sqrt(stiffness * mass))
damped_omega = omega * math.sqrt(1.0 - zeta * zeta)
dt = 1.0 / 60.0
position = 0.1
velocity = 0.0
target = position
print("frame,time_ms,x,velocity")
for frame in range(181):
    if frame:
        displacement = position - target
        a = displacement
        b = (velocity + displacement * zeta * omega) / damped_omega
        decay = math.exp(-zeta * omega * dt)
        c = math.cos(damped_omega * dt)
        s = math.sin(damped_omega * dt)
        position = target + decay * (a * c + b * s)
        velocity = decay * (
            (b * damped_omega - a * zeta * omega) * c
            - (a * damped_omega + b * zeta * omega) * s
        )
    if frame >= 60:
        target = 0.9
    print(f"{frame},{frame * 1000 / 60:.15g},{position:.16g},{velocity:.16g}")
