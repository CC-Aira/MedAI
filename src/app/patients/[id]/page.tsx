import { notFound } from "next/navigation";
import PatientDetail from "@/components/PatientDetail";
import SheetShell from "@/components/SheetShell";
import { requireUser } from "@/lib/auth";
import { findOwnedPatient, serializePatient } from "@/lib/patients";
import { listNotes } from "@/lib/notes";
import { listConsultations } from "@/lib/consultations";
import { getGrowth } from "@/lib/growth";

export const dynamic = "force-dynamic";

export default async function PatientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;

  const row = await findOwnedPatient(user.id, id);
  if (!row) notFound();

  const [notes, consultations, growth] = await Promise.all([
    listNotes(user.id, id),
    listConsultations(user.id, id),
    getGrowth(user.id),
  ]);

  return (
    <SheetShell backHref="/" backLabel="回到小兔子">
      <PatientDetail
        patient={serializePatient(row)}
        notes={notes}
        consultations={consultations}
        growth={growth}
      />
    </SheetShell>
  );
}
