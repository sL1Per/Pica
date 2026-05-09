# TODO

### Bugs

- Punches don't work if location is blocked or not available. Can we force the browser to ask again if its already blocked? Change punches to not block, if it can great if not its also ok. (1)
- Getting a http 400 when submitting vacations: "WARN  POST /api/leaves 400 4ms" This happens when someone is doing it via internet, in the localhost i cannot reproduce this. --> Check picture on desktop -> this happens when limit is reach but we need to fix the error and show a message to the user (1)
- when login --> Check picture on desktop (1)
- employee cannot see his profile (1)

### Change

- employee should not see other employee leaves (1)
- remove time bank, not needed, improve report to show who is missing hours and how many (3)
- improve calendar in mobile phone, cannot read details
- Reports revamp
- leave that move to next year need to expire at some point, add this option (2)

### Add

- add an feature / options to block day or days from being able to book vacations (employer is exception) (5)
- add email notifications
- make profile fields mandatory (2)
- on punches, on the same day, show break time (lunch and so on) (4)
- add employee name also to filters for the leaves (on opt of the state)
- add ability to upload files for justifications

### Translations

- Marcacao -> Ponto

### Production

- remove any placeholder or mention to future milestone / development notes, etc.
- deploy server to make it accessible by other people, INTRANET only?
- ssl ? - can be self-signed ..
- update README
- update RELEASE
- create full documentation for implementation (architecture, technical guide ,deployment, etc)
- create user guide
- move everything to claude code -> Ask to create skills / hooks / (sub)agents

## Outro

``git add .``

``git commit -m "comment here"``

``git push origin main``
