# TODO

### Roadmap

- M13: E2E browser tests
- M14: Deployment guide + TLS samples

### Bugs

- [**DONE**] Punches don't work if location is blocked or not available. Can we force the browser to ask again if its already blocked? Change punches to not block, if it can great if not its also ok. (1)
- [**DONE**] Getting a http 400 when submitting vacations: "WARN  POST /api/leaves 400 4ms" This happens when someone is doing it via internet, in the localhost i cannot reproduce this. --> Check picture on desktop -> this happens when limit is reach but we need to fix the error and show a message to the user (1)
- [**DONE**] Employee cannot see his profile (1)
- [**DONE**] Employees are able to book vacations even if another one has already approved leave for the same day and the option in the settings page is not selected, meaning it should not be allowed for an employee to book vacation when another one already have a leave approved for the same day.

### Change

- [**DONE**] Employee should not see other employee leaves (1)
- [**DONE**] Remove time bank, not needed, improve report to show who is missing hours and how many (3)
- [**DONE**] Improve calendar in mobile phone, cannot read details
- Reports revamp
- [**DONE**] Leaves that move to next year need to expire at some point. Add a option in the organization settings to set the date when the vacations that moved from previous year expire. This should also reflect on the amount each employee has. (2)
- Infinite approved / rejected / etc view, need a way to show only last 10.
- [**DONE**] Make profile fields mandatory (2)
- [**DONE**] Instead of showing coordinates, try to show an approximate address.

### Add

- [**DONE**] Add an option to block day(s) from being bookable by an employee (employer can always do it). For example a special event day or days where the employer needs to make sure that all his employees are working so no leaves allowed for that specific day(s). This option should be added in the settings page and only the employer should have access to it. (5)
- Add email notifications
- [**DONE**] On punches, on the same day, show break time. For example, clock in at 9am clock out at 12PM and then clock in at 1PM and clock out at 6PM, i want to see in the UI total work time was 8h and break of 1h (4)
- Add employee names also to filters for the leaves (on opt of the state). this is for the employer only view.
- Add ability to upload files for justifications
- Add profile picture every time the name appears in the UI except on headings.
- Add an option to reset the masterkey

### Translations

- Some changes needed in pt_PT

### Before Production

- remove any placeholder or mention to future milestone / development notes, etc.
- Deploy server to make it accessible by other people, INTRANET only?
- ssl ? - can be self-signed ..
- Update documentation fully
- Create user guide
