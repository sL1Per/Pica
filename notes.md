# TODO

### Roadmap

- M16: Full code review / code optimization / code simplification
- M17: Full security review
- M18: Deployment guide + TLS samples
- M19: User guide
- M20: Project documentation update

### Bugs

- [**DONE**] Punches don't work if location is blocked or not available. Can we force the browser to ask again if its already blocked? Change punches to not block, if it can great if not its also ok. (1)
- [**DONE**] Getting a http 400 when submitting vacations: "WARN  POST /api/leaves 400 4ms" This happens when someone is doing it via internet, in the localhost i cannot reproduce this. --> Check picture on desktop -> this happens when limit is reach but we need to fix the error and show a message to the user (1)
- [**DONE**] Employee cannot see his profile (1)
- [**DONE**] Employees are able to book vacations even if another one has already approved leave for the same day and the option in the settings page is not selected, meaning it should not be allowed for an employee to book vacation when another one already have a leave approved for the same day.
- [**DONE**] As an employer, If i go to team and then click on my profile, i get a blank page
- [**DONE**] Side bar (on the left) should not scroll, only the content page (right side) should
- [**DONE**] Correction modal buttons are not align
- [**DONE**] on the punch page, this week tab, search bar is missing icon and white background, like the one on the team page
- Clicking things from the bell do not show the modal and go to the respective pages instead. It should show the modals.

### Change

- [**DONE**] Make view a requested leave (not a new one but one that was already submitted) as a modal as well
- [**DONE**] As an employee, on the calendar page, remove the filter to view team or mine leaves. all leaves should be visible but as an employee i should not see who is on leave just that there is someone already on leave that day (this feature is already implemented, make sure its kept)
- [**DONE**] Employee should not see other employee leaves (1)
- [**DONE**] Remove time bank, not needed, improve report to show who is missing hours and how many (3)
- [**DONE**] Improve calendar in mobile phone, cannot read details
- [**DONE**] Leaves that move to next year need to expire at some point. Add a option in the organization settings to set the date when the vacations that moved from previous year expire. This should also reflect on the amount each employee has. (2)
- [**DONE**] Make profile fields mandatory (2)
- [**DONE**] Instead of showing coordinates, try to show an approximate address.
- [**DONE**] Reports revamp
- Make Slate pallet with light color mode the default
- Add leaves balance cards also to employer view
- backups is not done to config.json file, it should be no?

### Add

- [**DONE**] Add an option to block day(s) from being bookable by an employee (employer can always do it). For example a special event day or days where the employer needs to make sure that all his employees are working so no leaves allowed for that specific day(s). This option should be added in the settings page and only the employer should have access to it. (5)
- [**DONE**] On punches, on the same day, show break time. For example, clock in at 9am clock out at 12PM and then clock in at 1PM and clock out at 6PM, i want to see in the UI total work time was 8h and break of 1h (4)
- [**DONE**] Add ability to upload files on leave request for justification. Max 5mb file size. This needs to be encrypted on the disk/storage but visible to the employer or the employee that updated (not to other employees!)
- [**DONE**] Add an option to reset the master-key (0.23.0: envelope encryption + passphrase change + rotation + recovery code + wipe-reset)
- Employer to create employee positions and employees need to pick up from a select box instead of current free text.
- [**DONE**] email notifications
- Need a way to filter out big list of leaves / corrections etc. After a few months the list will be huge. Maybe show only latest 10 or 15? Rest goes into reports?

### Translations

- Some changes needed in pt_PT

### Before Production

- test backup restore
- test masterkey rotation
- Deploy server to make it accessible by other people, INTRANET only?
- ssl ? - can be self-signed ..
- Update documentation fully
- Create user guide
