import { redirect } from 'next/navigation';

export default function AdminErrorsPage() {
  redirect('/admin/logs');
}