# TODO

### Roadmap

- M13: E2E browser tests
- M14: Deployment guide + TLS samples

### Bugs

- [**DONE**] Punches don't work if location is blocked or not available. Can we force the browser to ask again if its already blocked? Change punches to not block, if it can great if not its also ok. (1)
- [**DONE**] Getting a http 400 when submitting vacations: "WARN  POST /api/leaves 400 4ms" This happens when someone is doing it via internet, in the localhost i cannot reproduce this. --> Check picture on desktop -> this happens when limit is reach but we need to fix the error and show a message to the user (1)
- [**DONE**]employee cannot see his profile (1)

### Change

- [**DONE**] employee should not see other employee leaves (1)
- [**DONE**] remove time bank, not needed, improve report to show who is missing hours and how many (3)
- [**DONE**] improve calendar in mobile phone, cannot read details
- Reports revamp
- [**DONE**] leave that move to next year need to expire at some point. Add a option in the organization settings to set the date when the vacations that moved from previous year expire. This should also reflect on the amount each employee has. (2)
- infinite approved / rejected / etc view, need a way to show only last 10.
- [**DONE**] make profile fields mandatory (2)
- [**DONE**] instead of showing coordinates, try to show an approximate address.

### Add

- add an feature / options to block day or days from being able to book vacations (employer is exception) (5)
- add email notifications
- on punches, on the same day, show break time (lunch and so on) (4)
- add employee name also to filters for the leaves (on opt of the state)
- add ability to upload files for justifications
- add profile picture every time the name appears in the UI except on headings.

### Translations

- Some changes needed in pt_PT

### Before Production

- remove any placeholder or mention to future milestone / development notes, etc.
- deploy server to make it accessible by other people, INTRANET only?
- ssl ? - can be self-signed ..
- update documentation fully
- create user guide
