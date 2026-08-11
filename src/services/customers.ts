import type { Customer } from '../lib/types';
import { VALIDATION } from '../lib/constants';
import type { DataService } from './data';

export function normalizePhone(phone: string): string {
  return phone.trim().replace(/\s+/g, ' ').replace(/-/g, '');
}

export interface CustomerInput {
  name: string;
  phone: string;
  address: string;
  email: string;
}

export function validateCustomer(input: CustomerInput): string | null {
  if (!input.name.trim()) return 'Customer name is required.';
  const phone = normalizePhone(input.phone);
  if (!phone) return 'Phone number is required.';
  if (!VALIDATION.phonePattern.test(phone)) return 'Enter a valid phone number (8–15 digits).';
  if (input.email && !/^\S+@\S+\.\S+$/.test(input.email.trim())) return 'Enter a valid email address.';
  return null;
}

export async function createCustomer(svc: DataService, input: CustomerInput): Promise<Customer> {
  const err = validateCustomer(input);
  if (err) throw new Error(err);
  const data = {
    name: input.name.trim(),
    phone: normalizePhone(input.phone),
    address: input.address.trim(),
    email: input.email.trim()
  };
  const id = await svc.add('customers', data);
  return { id, ...data, createdAt: '', updatedAt: '' } as Customer;
}

export async function updateCustomer(svc: DataService, id: string, input: CustomerInput): Promise<void> {
  const err = validateCustomer(input);
  if (err) throw new Error(err);
  await svc.set('customers', id, {
    name: input.name.trim(),
    phone: normalizePhone(input.phone),
    address: input.address.trim(),
    email: input.email.trim()
  });
}

export async function deleteCustomer(svc: DataService, id: string): Promise<void> {
  await svc.delete('customers', id);
}

/** Full-text search across name/phone. */
export function searchCustomers(customers: Customer[], term: string): Customer[] {
  const t = term.trim().toLowerCase();
  if (!t) return customers;
  return customers.filter(
    (c) => c.name.toLowerCase().includes(t) || c.phone.replace(/\s/g, '').includes(t.replace(/\s/g, ''))
  );
}
