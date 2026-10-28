# StreamPlaza

Plataforma de venta y administración de suscripciones digitales: tienda online, carrito, pago con QR (Yape/Plin) revisado por un empleado, entrega automática de códigos, portal del cliente, panel administrativo con roles, bot de ventas por WhatsApp Cloud API, recordatorios de vencimiento programados y notificaciones por correo y WhatsApp.

## Tecnología

| Capa | Elección |
|---|---|
| Web y API | Next.js 15 (App Router, Server Actions) + React 19 + TypeScript |
| Base de datos | PostgreSQL + Prisma 6 (migraciones en `prisma/migrations`) |
| Sesión | Cookie httpOnly firmada (JWT HS256, `jose`) + contraseñas con bcrypt |
| Tareas programadas | Proceso `npm run worker` (o `POST /api/cron` desde un cron externo) |
| Correo | SMTP con `nodemailer` |
| WhatsApp | API oficial WhatsApp Cloud (Meta Graph API) |
| Comprobantes PDF | `pdf-lib` |
| Pruebas | Vitest contra PostgreSQL real |

## Módulos

- **Tienda** (`/`, `/producto/[slug]`, `/carrito`): catálogo con categorías y búsqueda, planes por duración, carrito, cupones. El precio siempre lo calcula el servidor.
- **Pago manual con QR**: el pedido reserva el stock, el cliente paga con el QR y sube el número de operación con la foto del comprobante. Un empleado escribe el **monto que llegó a la cuenta**, que debe coincidir con el total, y aprueba. El pedido nunca se marca como pagado por lo que muestre el navegador.
- **Entrega**: al aprobar el pago, en la misma transacción se asigna el código reservado, se crea la suscripción y el pedido pasa a ENTREGADO. Si falta stock queda en PROCESADO con una alerta y un botón «Reintentar entrega». Los productos de tipo MANUAL los entrega un empleado escribiendo la nota de acceso.
- **Códigos y licencias** (`/admin/licencias`): alta manual o importación CSV, clasificados por producto y proveedor. Estados: disponible, reservado, entregado y vencido. Se guardan cifrados con AES-256-GCM y una huella HMAC impide duplicados. Solo el administrador ve el código completo, y cada vista queda en el historial.
- **Suscripciones**: inicio, vencimiento, días restantes, renovación (suma días desde el vencimiento sin consumir otro código), cancelación y su historial de eventos.
- **Recordatorios**: el worker avisa los días configurados (por defecto 7, 3, 1 y 0) aunque nadie abra la web. Además marca vencidas las suscripciones, vence las licencias caducadas y cancela pedidos sin pago tras 48 h liberando el stock. Una clave de deduplicación impide repetir avisos.
- **Portal del cliente** (`/cuenta`): pedidos y su estado, pago, suscripciones con código e instrucciones, renovación, historial de pagos, comprobante PDF, soporte y preferencias de aviso. Cada cliente solo accede a lo suyo.
- **Panel** (`/admin`): ventas e ingresos por día, semana y mes con un gráfico de 14 días. Alertas de pagos por revisar, pedidos sin entregar, vencimientos, poco stock, chats con asesor, soporte y avisos fallidos. Tablas con búsqueda, filtros, orden y paginación.
- **Roles**: Administrador (todo), Empleado (ventas, pagos, entregas, clientes, suscripciones, carga de códigos sin verlos, soporte y WhatsApp) y Cliente. Cada acción del servidor comprueba el permiso; el rol se lee de la base de datos en cada petición.
- **Bot de WhatsApp** (`/api/whatsapp/webhook`): menú, catálogo, planes y precios, confirmación y creación del pedido. Envía el enlace seguro de pago, recibe la foto del comprobante en el chat, informa el estado de los pedidos y pasa la conversación a una persona («asesor»). Verifica la firma `X-Hub-Signature-256` y descarta los mensajes repetidos por su id.
- **Notificaciones** (`/admin/notificaciones`): una cola central para confirmaciones de compra, pagos, entregas, recordatorios, renovaciones y alertas internas. Reintenta con espera creciente. Si falta un canal, el aviso queda **OMITIDO** con el motivo y nunca se marca como enviado.

## Puesta en marcha local

Requisitos: Node.js 20 o superior.

```bash
npm install
```

```bash
npm run db:local
```
Deja ese terminal abierto: arranca un PostgreSQL local en UTF-8 (puerto 54330) sin Docker. Si ya tienes PostgreSQL, apunta `DATABASE_URL` a tu base y omite este paso.

```bash
cp .env.example .env
```
Genera `AUTH_SECRET`, `ENCRYPTION_KEY` y `CRON_SECRET` con:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```bash
npm run db:migrate
```

```bash
npm run admin:create
```
Usa `ADMIN_EMAIL` y `ADMIN_PASSWORD` del `.env` (mínimo 10 caracteres).

```bash
npm run db:seed
```
Opcional: crea un producto de demostración con 5 códigos de prueba. Solo funciona contra una base local.

```bash
npm run dev
```

```bash
npm run worker
```
En otro terminal: tareas programadas y envío de avisos.

Después entra a `http://localhost:3000/ingresar`, ve al panel y en **Configuración** sube tu QR de cobro.

## Producción

1. Un PostgreSQL gestionado (Neon, Supabase, RDS, Railway…) con codificación **UTF8**.
2. En el servidor: `npm ci`, `npm run build`, `npm run db:migrate`, `npm run admin:create`.
3. Dos procesos permanentes (por ejemplo con PM2 o systemd): `npm run start` y `npm run worker`. Si tu hosting no permite procesos permanentes, programa cada 5 minutos:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://tu-dominio.com/api/cron
```

4. HTTPS obligatorio (Meta no acepta webhooks sin https). `APP_URL` debe ser la URL pública.
5. `UPLOAD_DIR` en un disco persistente y con copia de seguridad: ahí van los comprobantes y el QR. **Guarda también `ENCRYPTION_KEY`**: sin ella los códigos guardados no se pueden leer.
6. El freno de intentos de inicio de sesión vive en la memoria del proceso. Con varias instancias, muévelo a Redis.

## Variables de entorno

| Variable | Obligatoria | Uso |
|---|---|---|
| `DATABASE_URL` | Sí | Conexión a PostgreSQL |
| `APP_URL` | Sí | URL pública, para enlaces en avisos y el bot |
| `AUTH_SECRET` | Sí | Firma de sesiones (64 hex) |
| `ENCRYPTION_KEY` | Sí | Cifrado de códigos (64 hex) |
| `CRON_SECRET` | Si usas `/api/cron` | Token del cron externo |
| `UPLOAD_DIR` | No | Carpeta privada de archivos (`./storage/uploads`) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Para `admin:create` | Primer administrador |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Para correo | Avisos por email |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN` | Para WhatsApp | Envío de mensajes |
| `WHATSAPP_APP_SECRET` | Para el bot | Verifica la firma de los webhooks |
| `WHATSAPP_VERIFY_TOKEN` | Para el bot | Texto que inventas y pegas en Meta |
| `WHATSAPP_TEMPLATE_NOTICE`, `WHATSAPP_TEMPLATE_LANG` | Para recordatorios por WhatsApp | Plantilla aprobada con una variable `{{1}}` |

## Conectar WhatsApp Cloud API

1. En [Meta for Developers](https://developers.facebook.com/) crea una app de tipo Empresa y agrega el producto **WhatsApp**. Necesitas una cuenta de Meta Business verificada y un número que no esté usando la app de WhatsApp.
2. En WhatsApp → Configuración de la API copia el **Phone number ID** y genera un **token permanente** de un usuario del sistema (Business Settings → Usuarios del sistema) con permisos `whatsapp_business_messaging` y `whatsapp_business_management`.
3. En la configuración básica de la app copia la **Clave secreta** → `WHATSAPP_APP_SECRET`.
4. En WhatsApp → Configuración → Webhook: URL `https://tu-dominio.com/api/whatsapp/webhook`, token de verificación = `WHATSAPP_VERIFY_TOKEN`, y suscribe el campo **messages**.
5. Los recordatorios suelen salir fuera de la ventana de 24 h, y WhatsApp solo permite enviarlos con una **plantilla aprobada**. Crea una plantilla (categoría *Utilidad*) cuyo cuerpo sea solo `{{1}}`, espera a que la aprueben y pon su nombre en `WHATSAPP_TEMPLATE_NOTICE`. Sin plantilla, esos avisos se envían solo por correo y en WhatsApp quedan como omitidos.

## Pruebas

```bash
npm test
```
Necesita la base local en marcha (`npm run db:local`): usa la base `streamplaza_test` y la vacía en cada prueba.

26 pruebas de integración contra PostgreSQL real:

- **Registro e inicio de sesión:** registro, inicio de sesión y reclamo de un número usado por WhatsApp.
- **Pedidos:** precios del servidor, cupón con límite de usos, sin sobreventa, cinco pedidos simultáneos con tres códigos, deduplicación del mismo envío, cancelación que libera stock y cancelación automática a las 48 h.
- **Pagos:** monto exacto, aprobaciones simultáneas que entregan una sola vez, número de operación repetido, comprobante duplicado, enlace con token falso, rechazo y nuevo envío, falta de stock y reintento, entrega manual y reembolso.
- **Suscripciones:** renovación sin consumir otro código, renovación ajena bloqueada, recordatorios sin duplicados, vencimiento, y avisos omitidos (nunca enviados) sin credenciales.
- **Licencias:** cifrado e importación CSV con duplicados y errores.
- **Bot de WhatsApp:** verificación del webhook, firma inválida rechazada, compra completa por chat, mensaje repetido ignorado, paso a asesor y consulta de estado.

## Limitaciones y pendientes

- **No hay pasarela de pago automática:** el pago lo confirma una persona al ver el dinero en su cuenta, como se eligió. Para cobro automático con webhooks (Mercado Pago, Culqi o Izipay) hay que agregar un proveedor en `src/server/payments.ts`.
- **El comprobante PDF es interno** y no reemplaza a una boleta o factura electrónica (SUNAT u otro ente).
- **Telegram no está implementado.** Los canales disponibles son correo y WhatsApp.
- **Las imágenes y comprobantes se guardan en disco local.** Para varios servidores conviene S3 o similar.
- **Revisa los términos de servicio de cada plataforma:** vender cuentas o perfiles de servicios como Netflix o Disney+ suele violarlos, y las pasarelas de pago pueden cerrar la cuenta del comercio. El sistema está pensado para licencias y accesos que tengas autorización para revender.
