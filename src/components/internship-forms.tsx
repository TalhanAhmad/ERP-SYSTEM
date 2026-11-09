"use client";
import { TextareaField } from "./textarea-field";
import { MutationForm } from "./mutation-form";
type Person = {
  id: string;
  displayName: string;
  username: string;
  status: string;
};
type Enrollment = {
  id: string;
  version: number;
  internId: string;
  mentorId: string;
  departmentId: string;
  startDate: string;
  endDate: string;
  objective: string;
  status: string;
};
export function EnrollmentForm({
  options,
  item,
}: {
  options: {
    interns: Person[];
    mentors: Person[];
    departments: { id: string; name: string; archivedAt: string | null }[];
  };
  item?: Enrollment;
}) {
  return (
    <MutationForm
      endpoint={item ? "/api/v1/internships/" + item.id : "/api/v1/internships"}
      label={item ? "Save enrollment" : "Enroll intern"}
      resetOnSuccess={!item}
      transform={(f) => ({
        ...Object.fromEntries(f),
        expectedVersion: item?.version ?? 0,
        ...(!f.get("reason") ? { reason: undefined } : {}),
      })}
    >
      <div className="form-grid">
        <label>
          Intern
          <select name="internId" required defaultValue={item?.internId ?? ""}>
            <option value="">Select intern</option>
            {options.interns
              .filter((p) => !item || p.id === item.internId)
              .map((p) => (
                <option value={p.id} key={p.id}>
                  {p.displayName} (@{p.username}) · {p.status.toLowerCase()}
                </option>
              ))}
          </select>
        </label>
        <label>
          Mentor
          <select name="mentorId" required defaultValue={item?.mentorId ?? ""}>
            <option value="">Select independent mentor</option>
            {options.mentors.map((p) => (
              <option value={p.id} key={p.id}>
                {p.displayName} (@{p.username}) · {p.status.toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <label>
          Department
          <select
            name="departmentId"
            required
            defaultValue={item?.departmentId ?? ""}
          >
            <option value="">Select department</option>
            {options.departments
              .filter((d) => !d.archivedAt || d.id === item?.departmentId)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Internship start
          <input
            type="date"
            name="startDate"
            required
            defaultValue={item?.startDate}
          />
        </label>
        <label>
          Internship end
          <input
            type="date"
            name="endDate"
            required
            defaultValue={item?.endDate}
          />
        </label>
        <label>
          Enrollment status
          <select name="status" defaultValue={item?.status ?? "ACTIVE"}>
            <option>ACTIVE</option>
            {item && (
              <>
                <option>COMPLETED</option>
                <option>CANCELED</option>
              </>
            )}
          </select>
        </label>
      </div>
      <TextareaField
        label="Learning objective"
        name="objective"
        required
        maxLength={5000}
        defaultValue={item?.objective}
      />
      {item && (
        <TextareaField
          label="Reason for enrollment change"
          name="reason"
          required
          maxLength={1000}
        />
      )}
      <p className="note">
        One active enrollment per intern. The mentor must be an independent
        active Team Lead or Super Admin. Complete all milestones before
        completing the enrollment.
      </p>
    </MutationForm>
  );
}
export function MilestoneForm({
  internshipId,
  startDate,
  endDate,
  tasks,
  item,
}: {
  internshipId: string;
  startDate: string;
  endDate: string;
  tasks: { id: string; title: string; status: string }[];
  item?: {
    id: string;
    version: number;
    title: string;
    description: string;
    dueDate: string;
    taskIds: string[];
  };
}) {
  return (
    <MutationForm
      endpoint={
        item
          ? "/api/v1/milestones/" + item.id
          : "/api/v1/internships/" + internshipId + "/milestones"
      }
      label={item ? "Save milestone" : "Add milestone"}
      resetOnSuccess={!item}
      transform={(f) => ({
        expectedVersion: item?.version ?? 0,
        title: f.get("title"),
        description: f.get("description"),
        dueDate: f.get("dueDate"),
        taskIds: f.getAll("taskIds"),
      })}
    >
      <label>
        Milestone title
        <input
          name="title"
          required
          maxLength={200}
          defaultValue={item?.title}
        />
      </label>
      <TextareaField
        label="Milestone description"
        name="description"
        maxLength={5000}
        defaultValue={item?.description}
      />
      <label>
        Milestone due date
        <input
          type="date"
          name="dueDate"
          min={startDate}
          max={endDate}
          required
          defaultValue={item?.dueDate}
        />
      </label>
      <fieldset>
        <legend>Required work evidence</legend>
        {tasks.map((t) => (
          <label className="file-choice" key={t.id}>
            <input
              name="taskIds"
              type="checkbox"
              value={t.id}
              defaultChecked={item?.taskIds.includes(t.id)}
            />
            {t.title} · {t.status.toLowerCase()}
          </label>
        ))}
      </fieldset>
      <p className="note">
        Only your accessible tasks assigned to this intern are listed. The
        intern submits evidence after submitting the linked work; completion
        requires every linked task to be approved.
      </p>
    </MutationForm>
  );
}
export function MilestoneActionForm({
  id,
  version,
  status,
  label,
  reasonRequired = false,
}: {
  id: string;
  version: number;
  status: "ACTIVE" | "SUBMITTED" | "COMPLETED";
  label: string;
  reasonRequired?: boolean;
}) {
  return (
    <MutationForm
      endpoint={"/api/v1/milestones/" + id + "/status"}
      label={label}
      transform={(f) => ({
        expectedVersion: version,
        status,
        ...(f.get("reason") ? { reason: f.get("reason") } : {}),
      })}
    >
      {reasonRequired && (
        <TextareaField
          label="Reason / mentor override"
          name="reason"
          required
          maxLength={1000}
        />
      )}
    </MutationForm>
  );
}
export function FeedbackForm({
  internshipId,
  override = false,
  item,
}: {
  internshipId: string;
  override?: boolean;
  item?: {
    version: number;
    weekStart: string;
    strengths: string;
    improvements: string;
    nextActions: string;
    rating: number | null;
    ratingExplanation: string | null;
  };
}) {
  return (
    <MutationForm
      endpoint={"/api/v1/internships/" + internshipId + "/feedback"}
      label={item ? "Save weekly feedback" : "Add weekly feedback"}
      resetOnSuccess={!item}
      transform={(f) => ({
        ...Object.fromEntries(f),
        expectedVersion: item?.version ?? 0,
        rating: f.get("rating") ? Number(f.get("rating")) : null,
        ratingExplanation: f.get("ratingExplanation") || null,
        ...(!f.get("overrideReason") ? { overrideReason: undefined } : {}),
      })}
    >
      <label>
        Week starts (Monday)
        <input
          type="date"
          name="weekStart"
          required
          readOnly={!!item}
          defaultValue={item?.weekStart}
        />
      </label>
      <TextareaField
        label="Strengths"
        name="strengths"
        required
        maxLength={5000}
        defaultValue={item?.strengths}
      />
      <TextareaField
        label="Areas to improve"
        name="improvements"
        required
        maxLength={5000}
        defaultValue={item?.improvements}
      />
      <TextareaField
        label="Next actions"
        name="nextActions"
        required
        maxLength={5000}
        defaultValue={item?.nextActions}
      />
      <label>
        Optional explained rating
        <select name="rating" defaultValue={item?.rating ?? ""}>
          <option value="">No rating</option>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </label>
      <TextareaField
        label="Rating explanation"
        name="ratingExplanation"
        maxLength={2000}
        defaultValue={item?.ratingExplanation ?? ""}
      />
      {override && (
        <TextareaField
          label="Super Admin mentor override reason"
          name="overrideReason"
          required
          maxLength={1000}
        />
      )}
      <p className="note">
        Feedback is private to this internship’s intern, current mentor and
        Super Admin. Ratings are optional feedback, not an employee ranking.
      </p>
    </MutationForm>
  );
}
