export function barbersForService<T extends { id: string; serviceIds: string[] }>(barbers: T[], serviceId: string): T[] {
  return barbers.filter((barber) => barber.serviceIds.includes(serviceId));
}

export function servicesForBarber<T extends { id: string }>(services: T[], serviceIds: string[]): T[] {
  return services.filter((service) => serviceIds.includes(service.id));
}
