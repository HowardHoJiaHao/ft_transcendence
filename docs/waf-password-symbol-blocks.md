# WAF blocking combinations for passwords

Checked: 2026-10-03, against the running ModSecurity OWASP CRS filter at paranoia level 1.

The filter does not block a password for using many symbols. One match is enough. It blocks 16 exact three-character sequences, and only when a letter or a digit comes before the sequence.

These sequences are blocked after a letter or a digit:

- `!@#`
- `%@#`
- `&&@`
- `&@#`
- `)!@`
- `)#@`
- `)%@`
- `)&@`
- `)(!`
- `)(&`
- `)*@`
- `)+@`
- `)^@`
- `*@#`
- `+@#`
- `^@#`

`Aa1!@#` is blocked because `!@#` comes after `1`. `Aa1!@#$%` is blocked for the same reason: `!@#` is inside it. `A!@#` and `1!@#` are blocked too.

`!@#Aa1` is not blocked, because that sequence is at the start. One symbol is not blocked, including `Abcdef1!` and `Abcdef1#`. Two different symbols are not blocked, including `Abcdef1!@`. Repeating one symbol is not blocked, including `Aa1x!!!!!!!`. `MyPass1!_word` and `Hello1()+_` are not blocked.

All 1,728 three-symbol sequences from `!@#$%^&*()_+` were sent to the running filter. These 16 were the only ones blocked. The same password was either blocked on register, login, and both change-password steps, or allowed through on all four. A blocked request does not stick: the next page still loads, and the browser does not need a restart.
