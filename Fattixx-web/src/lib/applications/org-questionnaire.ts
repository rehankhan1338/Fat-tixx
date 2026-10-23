'use server';

import { redirect } from 'next/navigation';
import { audit } from '../audit';
import { assertOrg } from '../authz';
import { execute } from '../db';
import { QUESTIONS, readAnswers } from './questionnaire';

/**
 * The organizer sign-up questionnaire for an organization created on /create (project plan, "Organizer Sign Up"):
 * the same six skippable questions as the /sell application, stored on the organization. Answering or skipping
 * marks it done, so the dashboard stops sending its admin to /org/<slug>/welcome.
 */
export async function saveOrgQuestionnaire(fd: FormData): Promise<void> {
  const slug = String(fd.get('org') ?? '');
  const ctx = await assertOrg(slug, 'org_admin');
  const answers = readAnswers(fd);
  await execute(
    `UPDATE organizations SET ${QUESTIONS.map((q) => `${q.name} = ?`).join(', ')}, questionnaire_done_at = NOW() WHERE id = ?`,
    [...QUESTIONS.map((q) => answers[q.name]), ctx.org.id],
  );
  await audit('org.questionnaire', { actorUserId: ctx.session.user.id, targetType: 'organization', targetId: ctx.org.id, metadata: { answered: QUESTIONS.filter((q) => answers[q.name]).length } });
  redirect(`/org/${slug}`);
}
