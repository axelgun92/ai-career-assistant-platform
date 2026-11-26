"use client";

import { useState } from "react";
import { applicationContactRoleSchema, type ApplicationContactRole } from "@ai-career/core";
import { ExternalLink } from "../external-link";
import { CommandFeedback, FieldError } from "./command-feedback";
import { contactRoleLabels } from "./labels";
import type { ApplicationView } from "./types";
import { fieldError, useApplicationCommand, type CommandError } from "./use-application-command";

type Contact = ApplicationView["contacts"][number];
type ContactDraft = {
  name: string;
  role: ApplicationContactRole;
  title: string;
  organization: string;
  email: string;
  profileUrl: string;
  notes: string;
};

const emptyDraft: ContactDraft = { name: "", role: "RECRUITER", title: "", organization: "", email: "", profileUrl: "", notes: "" };

const draftFrom = (contact: Contact): ContactDraft => ({
  name: contact.name,
  role: contact.role,
  title: contact.title ?? "",
  organization: contact.organization ?? "",
  email: contact.email ?? "",
  profileUrl: contact.profileUrl ?? "",
  notes: contact.notes ?? "",
});

function ContactFields({
  draft,
  onChange,
  error,
  idPrefix,
}: {
  draft: ContactDraft;
  onChange: (draft: ContactDraft) => void;
  error: CommandError | null;
  idPrefix: string;
}) {
  const set = (key: keyof ContactDraft) => (event: { target: { value: string } }) =>
    onChange({ ...draft, [key]: event.target.value });
  const text = (key: Exclude<keyof ContactDraft, "role" | "notes">, label: string, type = "text") => (
    <label>
      {label}
      <input
        type={type}
        value={draft[key]}
        required={key === "name"}
        aria-invalid={fieldError(error, key) ? true : undefined}
        onChange={set(key)}
      />
      <FieldError message={fieldError(error, key)} id={`${idPrefix}-${key}-error`} />
    </label>
  );
  return (
    <div className="form-grid">
      {text("name", "Name")}
      <label>
        Relationship
        <select value={draft.role} onChange={set("role")}>
          {applicationContactRoleSchema.options.map((role) => (
            <option key={role} value={role}>
              {contactRoleLabels[role]}
            </option>
          ))}
        </select>
      </label>
      {text("title", "Role / title (optional)")}
      {text("organization", "Organization (optional)")}
      {text("email", "Email (optional)", "email")}
      {text("profileUrl", "LinkedIn or profile URL (optional)", "url")}
      <label>
        Notes (optional)
        <textarea rows={2} maxLength={2000} value={draft.notes} onChange={set("notes")} />
      </label>
    </div>
  );
}

function ContactItem({ applicationId, contact, readOnly }: { applicationId: string; contact: Contact; readOnly: boolean }) {
  const command = useApplicationCommand(applicationId);
  const [draft, setDraft] = useState<ContactDraft | null>(null);
  if (draft) {
    return (
      <li>
        <form
          aria-label={`Edit contact ${contact.name}`}
          onSubmit={async (event) => {
            event.preventDefault();
            const saved = await command.run({
              command: "updateContact",
              contactId: contact.id,
              expectedVersion: contact.version,
              ...draft,
            });
            if (saved) setDraft(null);
          }}
        >
          <ContactFields draft={draft} onChange={setDraft} error={command.error} idPrefix={`contact-${contact.id}`} />
          <div className="evaluation-actions">
            <button type="submit" disabled={command.pending}>Save contact</button>
            <button type="button" className="secondary-button" onClick={() => { setDraft(null); command.clearError(); }}>
              Cancel
            </button>
          </div>
          <CommandFeedback error={command.error} onReload={command.reload} />
        </form>
      </li>
    );
  }
  return (
    <li className="contact">
      <strong>{contact.name}</strong> <span className="status-label">{contactRoleLabels[contact.role]}</span>
      {contact.title || contact.organization ? (
        <span>{[contact.title, contact.organization].filter(Boolean).join(", ")}</span>
      ) : null}
      {contact.email ? <a href={`mailto:${contact.email}`}>{contact.email}</a> : null}
      {contact.profileUrl ? <ExternalLink href={contact.profileUrl}>Profile</ExternalLink> : null}
      {contact.notes ? <p className="field-help">{contact.notes}</p> : null}
      {readOnly ? null : (
        <button type="button" className="link-button" onClick={() => setDraft(draftFrom(contact))}>
          Edit
        </button>
      )}
    </li>
  );
}

function AddContact({ applicationId }: { applicationId: string }) {
  const command = useApplicationCommand(applicationId);
  const [draft, setDraft] = useState<ContactDraft>(emptyDraft);
  return (
    <details className="add-contact">
      <summary>Add contact</summary>
      <form
        aria-label="Add contact"
        onSubmit={async (event) => {
          event.preventDefault();
          if (await command.run({ command: "addContact", ...draft })) setDraft(emptyDraft);
        }}
      >
        <ContactFields draft={draft} onChange={setDraft} error={command.error} idPrefix="new-contact" />
        <button type="submit" disabled={command.pending}>Save contact</button>
        <CommandFeedback error={command.error} onReload={command.reload} />
      </form>
    </details>
  );
}

export function Contacts({ application, readOnly }: { application: ApplicationView; readOnly: boolean }) {
  return (
    <section className="application-section" aria-labelledby="contacts-title">
      <h3 id="contacts-title">Contacts</h3>
      {application.contacts.length ? (
        <ul className="contact-list" aria-label="Contacts">
          {application.contacts.map((contact) => (
            <ContactItem key={contact.id} applicationId={application.id} contact={contact} readOnly={readOnly} />
          ))}
        </ul>
      ) : (
        <p className="status-note">No contacts yet.</p>
      )}
      {readOnly ? null : <AddContact applicationId={application.id} />}
    </section>
  );
}
