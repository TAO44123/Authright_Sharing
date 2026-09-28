import Link from "next/link";
import { headers } from "next/headers";
import { webActor } from "@/server/http";
import { listAdminMembers } from "@/server/admin-members";
import MemberControls from "./member-controls";
import { config } from "@/server/config";
export const dynamic = "force-dynamic";
export default async function Admin({
  searchParams,
}: {
  searchParams: Promise<{ after?: string; query?: string }>;
}) {
  let result;
  let actor;
  try {
    actor = await webActor(await headers());
    result = await listAdminMembers(actor, await searchParams);
  } catch {
    return (
      <main>
        <h1>Administrator access required.</h1>
        <Link href="/library">Return to library</Link>
      </main>
    );
  }
  return (
    <main>
      <p className="eyebrow">ADMINISTRATION</p>
      <h1>Team members.</h1>
      <p className="muted">
        Anyone with a verified @{config.GOOGLE_WORKSPACE_DOMAIN} Google account
        can sign in. Members appear here automatically after their first
        sign-in. Administrators can manage roles.
      </p>
      <ul className="list">
        {result.members.map((member) => (
          <li className="member-row panel" key={member.id}>
            <h2>{member.email}</h2>
            <p className="muted">
              {member.name} · {member.role}
              {member.userId === actor.userId ? " · You" : ""}
            </p>
            {member.userId !== actor.userId && (
              <MemberControls id={member.id} role={member.role} />
            )}
          </li>
        ))}
      </ul>
      {result.next_cursor && (
        <Link href={`/admin?after=${result.next_cursor}`}>Next members →</Link>
      )}
    </main>
  );
}
