export { CRM } from './crm.js'
export type * from './crm-validation.js'
export { HR } from './hr.js'
export type * from './hr-validation.js'
export { BusinessEngine } from './service.js'
export { Runtime, actions, actionsFor, publicError } from './runtime.js'
export { OnlineLicense, httpsTransport } from './online-license.js'
export { DeviceQuotaExceeded, AuthorityDenied } from './license-protocol.js'
export { restaurantActions } from './restaurant-validation.js'
export type {
  RestaurantState,
  RestaurantOrder,
  RestaurantTable,
  MenuItem,
  OrderLine,
  Driver,
  Reservation,
  RecipeComponent,
} from './restaurant-types.js'
export type {
  AppState,
  User,
  Role,
  Product,
  Party,
  Invoice,
  InvoiceLine,
  Shift,
  Hold,
} from './types.js'

export type { Account, Journal, JournalLine } from './accounting-validation.js'
export type { Accounting, Period } from './accounting.js'

export { Inventory } from './inventory.js'
export type { InventoryLine, InventoryDocument, InventoryBalance } from './inventory-validation.js'

export { Manufacturing } from './manufacturing.js'
export type {
  ManufacturingBom,
  ProductionOrder,
  MaterialRequirement,
} from './manufacturing-validation.js'

export { Workshop } from './workshop.js'
export type {
  WorkshopVehicle,
  WorkshopTechnician,
  WorkshopOrder,
  WorkshopEstimate,
  WorkshopStatus,
} from './workshop-validation.js'

export { ServiceCenter } from './service-center.js'
export type {
  ServiceCenterDevice,
  ServiceCenterOrder,
  ServiceCenterEstimate,
  ServiceCenterTechnician,
  ServiceCenterStatus,
} from './service-center-validation.js'

export { Clinic } from './clinic.js'
export type {
  ClinicPatient,
  ClinicDoctor,
  ClinicService,
  ClinicAppointment,
  ClinicInvoice,
  ClinicStatus,
} from './clinic-validation.js'

export { Laboratory } from './laboratory.js'
export type {
  LabPatient,
  LabTest,
  LabOrder,
  LabSample,
  LabResult,
  LabReport,
  LabReportSnapshot,
  LabOrderDetail,
} from './laboratory-validation.js'

export { Pharmacy } from './pharmacy.js'
export type {
  PharmacyMedicine,
  PharmacySupplier,
  PharmacyLot,
  PharmacySale,
  PharmacyState,
  PharmacySaleDetail,
  PharmacyAllocation,
  PharmacyDocument,
} from './pharmacy-validation.js'

export { Education } from './education.js'
export type * from './education-validation.js'

export * from './gym-validation.js'

export * from './salon-validation.js'

export * from './hotel-validation.js'

export { RealEstate } from './real-estate.js'
export type * from './real-estate-validation.js'
