export type CategoriaFoto = 'individual' | 'grupal' | 'docente' | 'patio';

export interface Foto {
  id: string;
  url: string;
  thumbnail: string;
  categoria: CategoriaFoto;
  titulo: string;
  descripcion?: string;
  alumnoNombre?: string;
  grado?: string;
  division?: string;
}

export interface KitProducto {
  id: string;
  nombre: string;
  subtitulo?: string;
  tagline: string;
  precio: number;
  precioOriginal?: number;
  popular?: boolean;
  incluye: string[];
  icono: string;
  fotosPermitidas: {
    individuales: number;
    grupales: number;
    docentes: number;
  };
}

export interface Colegio {
  id: string;
  slug: string;
  nombre: string;
  localidad: string;
  zona: 'CABA' | 'Zona Norte' | 'Zona Sur' | 'Zona Oeste';
  eventoActual: string;
  grados: string[];
  divisiones: string[];
  turnos: string[];
  codigoAcceso: string;
  website?: string;
  whatsappContacto?: string;
}

export interface Pedido {
  id: string;
  codigoPedido: string;
  colegio: string;
  alumno: string;
  grado: string;
  division: string;
  tutorNombre: string;
  tutorTelefono: string;
  tutorEmail: string;
  kit: KitProducto;
  fotosSeleccionadas: {
    individual: string;
    grupal: string;
    docente?: string;
  };
  metodoPago: 'mercadopago' | 'transferencia' | 'efectivo';
  estadoPago: 'pendiente' | 'aprobado';
  montoTotal: number;
  fecha: string;
}

export interface Alumno {
  id: string;
  nombre: string;
  apellido?: string;
  colegioId?: string;
  colegio?: string;
  seccionId?: string;
  grado: string;
  division: string;
  turno?: string;
  codigoAcceso?: string;
  tutorNombre?: string;
  tutorEmail?: string;
  tutorTelefono?: string;
  estado?: 'pendiente' | 'pedido_confirmado' | 'entregado';
}

export interface SolicitudColegio {
  nombreInstitucion: string;
  cargo: string;
  contactoNombre: string;
  email: string;
  telefono: string;
  localidad: string;
  alumnosAproximados: number;
  niveles: ('inicial' | 'primaria' | 'secundaria')[];
  mensaje?: string;
}
