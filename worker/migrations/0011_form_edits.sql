-- Client forms become editable from admin; edits are stamped for the audit trail.
ALTER TABLE form_submissions ADD COLUMN updated_at TEXT;
ALTER TABLE form_submissions ADD COLUMN updated_by TEXT;
