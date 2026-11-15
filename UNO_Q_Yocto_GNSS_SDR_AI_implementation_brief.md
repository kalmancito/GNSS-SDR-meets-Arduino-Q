# Proyecto: Arduino UNO Q + Yocto + GNSS-SDR

**Documento de ejecución para un agente de IA con acceso a Git, terminal, compilador, repositorios y documentación web.**  
**Fecha de referencia:** 15 de noviembre de 2026.  
**Idioma de comunicación:** español. Código, nombres de archivos y comentarios técnicos: inglés.  
**Objetivo:** crear un receptor GNSS software-defined reproducible, basado en Arduino UNO Q (Qualcomm QRB2210) y una distribución propia Yocto/OpenEmbedded, con GNSS-SDR compilado para ARM64, capaz de procesar un fichero I/Q y posteriormente una fuente RF real.

> **INSTRUCCIÓN PRINCIPAL PARA LA IA:** no quiero un artículo ni solo una receta de instalación. **Quiero un repositorio de ingeniería funcional** con manifiestos `kas`, una capa Yocto propia, recetas, configuración GNSS-SDR, scripts de compilación/despliegue, pruebas, documentación de recuperación y un registro de resultados. Implementa y verifica todo lo que permita tu entorno. Lo que exija conectar físicamente el UNO Q debe quedar documentado, automatizado cuando sea posible y marcado claramente como **PENDIENTE DE ENSAYO EN HARDWARE**, nunca como prueba superada.

---

## 1. Contexto y alcance

### 1.1 Hardware objetivo

- **Placa:** Arduino UNO Q, **no** UNO R4, no Raspberry Pi, no una placa genérica RB1/RB2.
- **Procesador Linux:** Qualcomm Dragonwing QRB2210 (familia QCM2290), 4 × ARM Cortex-A53, AArch64.
- **MCU adicional:** STM32U585 con Zephyr; es un subsistema independiente y **no** ejecutará GNSS-SDR.
- **RAM/eMMC:** la placa existe en versiones de 2/4 GB y 16/32 GB; dimensionar para **2 GB RAM / 16 GB eMMC** como caso restrictivo. Detectar la variante real cuando se disponga de la placa.
- **Sistema de fábrica:** Linux Debian sobre el QRB2210. Queremos una imagen Yocto propia en vez de instalar GNSS-SDR con `apt` y dejar Debian como sistema final.
- **Interfaces de interés:** USB-C en modo host para periféricos SDR, Ethernet por adaptador si está soportado, Wi-Fi, almacenamiento eMMC, acceso serie de recuperación y, como fase posterior, comunicación con el STM32.
- **Entorno de compilación recomendado:** estación Linux x86_64 con Docker/Podman; usar `kas`/`kas-container`. Si el usuario trabaja desde Windows, emplear WSL2 Ubuntu con limitaciones de USB/EDL claramente documentadas; preferir Linux físico para flasheo.

### 1.2 Receptor GNSS objetivo

- **Software:** [GNSS-SDR](https://github.com/gnss-sdr/gnss-sdr), compilado de forma cruzada por BitBake para `aarch64`, no binarios ARM32 ni compilaciones hechas ad hoc con `apt` en el UNO Q.
- **Señal de MVP:** GPS L1 C/A, una sola banda y una sola antena.
- **Fuente de pruebas inicial:** I/Q grabado en fichero, con metadatos conocidos (frecuencia central, frecuencia de muestreo, formato, cuantización, escala, endianess e IF si procede).
- **Fuente RF en vivo prioritaria:** RTL-SDR **solo si admite 1575,42 MHz y se ha comprobado su estabilidad GNSS**, idealmente con antena activa GNSS, alimentación/bias-tee adecuada, filtro y/o LNA. Preferible usar el RTL-SDR disponible en laboratorio antes que comprar otro.
- **Alternativas:** ADALM-Pluto, interfaz de un digitizador GNSS propio, flujo remoto por red o fuente UDP; **no** habilitar soporte de SDR caros/voluminosos sin necesidad. Comprobar si `rtl_tcp`, Osmosdr, IIO, UHD o RAW_UDP realmente existen y funcionan en la versión de GNSS-SDR seleccionada.
- **Salida inicial:** logs, observables y solución PVT si el conjunto de datos lo permite; posteriormente RINEX y NMEA, sujeto a las opciones reales del programa.
- **Siguientes fases, fuera de MVP:** Galileo E1, doble frecuencia, OSNMA, adquisición acelerada, monitor PVT y conexión al LED matrix/STM32. No retrasar la versión 1 por estos objetivos.

### 1.3 Esquema de arquitectura

```text
             ANTENA GNSS + acondicionamiento RF
                           |
            +--------------+--------------+
            |                             |
      RTL-SDR / USB                  I/Q grabada
            |                             |
     USB-C en modo HOST                 eMMC/NFS
            |                             |
            +--------------+--------------+
                           |
                 Arduino UNO Q
               QRB2210 / AArch64
        +-------------------------------------+
        | Imagen Yocto propia                 |
        | - kernel, firmware y BSP Qualcomm   |
        | - drivers de USB/red                |
        | - librerías DSP/Volk/GNU Radio      |
        | - GNSS-SDR nativo ARM64             |
        | - systemd + configuraciones         |
        +------------------+------------------+
                           |
               NMEA / PVT / RINEX / logs
                           |
                      SSH / red
                           |
                   Equipo de desarrollo

      STM32U585 / Zephyr: NO crítico para MVP
```

---

## 2. Fuentes de verdad: examinar antes de programar

**Es obligatorio inspeccionar el contenido actual del repositorio**, no deducir interfaces ni nombres de paquetes de ejemplos antiguos. Registrar en `docs/research.md` URL, rama, commit SHA, fecha, licencia y la decisión técnica resultante.

| Fuente | URL | Qué revisar |
|---|---|---|
| BSP oficial UNO Q | https://github.com/qualcomm-linux/meta-qcom-arduino | `conf/machine`, `ci/uno-q.yml`, README, ramas, firmware y estrategia de empaquetado |
| BSP Qualcomm común | https://github.com/qualcomm-linux/meta-qcom | dependencias, KAS, kernel, imagen, procedimiento de flasheo |
| Flash Qualcomm | https://github.com/qualcomm-linux/meta-qcom/blob/master/docs/flashing.md | QDL, programador, imagen de despliegue, particiones |
| Capas Arduino | https://github.com/arduino/meta-arduino | si `meta-arduino-qcom`/`meta-arduino-common` aportan funciones imprescindibles y son compatibles |
| GNSS-SDR principal | https://github.com/gnss-sdr/gnss-sdr | `CMakeLists.txt`, `conf/`, ejemplos GPS L1 C/A, ramas, flags y dependencias actuales |
| Capa GNSS-SDR | https://github.com/carlesfernandez/meta-gnss-sdr | recetas existentes, ramas compatibles y dependencias |
| Layer Index | https://layers.openembedded.org/ | versiones, recetas y dependencias de capas |
| Guía cross-compiling | https://gnss-sdr.org/docs/tutorials/cross-compiling/ | buenas prácticas (algunos ejemplos son antiguos y ARM32; **no copiarlos literalmente**) |
| Hardware UNO Q | https://docs.arduino.cc/hardware/uno-q/ | conectores, potencia, consola y periféricos |
| Manual UNO Q | https://docs.arduino.cc/tutorials/uno-q/user-manual | modo host/ADB/conexiones y restauración |
| Forzar modo USB host | https://docs.arduino.cc/pt/tutorials/uno-q/host-mode/ | condiciones de alimentación externa y función de JCTL |
| Documentación Zephyr UNO Q | https://docs.zephyrproject.org/latest/boards/arduino/uno_q/doc/index.html | interacción futura con el MCU |
| KAS | https://kas.readthedocs.io/ | sintaxis actual de `kas`, includes, repos y build |
| Docs de GNU Radio | https://www.gnuradio.org/ | compatibilidad runtime y dependencias |

**Advertencias verificadas:**

1. `meta-qcom-arduino` anuncia `MACHINE = "uno-q"`. Su rama `main` sigue desarrollo reciente y la rama `wrynose` está asociada a Yocto 6.0 LTS / Qualcomm Linux 2.x. **No combinar ramas incompatibles** de `meta-qcom`, OE-Core, meta-openembedded y otras capas.
2. El README de `carlesfernandez/meta-gnss-sdr` **advierte expresamente que su rama `master` es experimental y no debe usarse para imágenes de producción**. Inspeccionar ramas de release; **no asumir** que existe una rama `wrynose` compatible. Si no existe, adaptar de manera controlada la receta en la capa propia.
3. La configuración de GNSS-SDR puede traer por defecto `ENABLE_UHD=ON` y `ENABLE_OSMOSDR=OFF` en determinadas revisiones. Revisar el `CMakeLists.txt` fijado y seleccionar drivers explícitamente. No asumir que un binario compilado soporta RTL-SDR.
4. El USB-C del UNO Q puede operar en distintos roles. La alimentación por VIN/5V por sí sola puede no habilitar VBUS host; seguir la documentación específica. **No** aplicar 3,3/5 V a señales JCTL de 1,8 V.
5. La instalación de una imagen personalizada en eMMC puede sobrescribir Debian y datos del equipo. Conservar un camino probado de recuperación antes del primer flasheo.

---

## 3. Decisiones de ingeniería que debes tomar y documentar

En `docs/decisions/` producir ADRs (Architecture Decision Records) para:

- **ADR-001, release Yocto:** comparar `meta-qcom-arduino/main` y `wrynose`; seleccionar preferentemente una versión estable **solo tras verificar** que soporta `uno-q` y compila. Fijar todos los commits. No usar ramas flotantes en entregas reproducibles.
- **ADR-002, GNSS-SDR recipe:** (A) portar `meta-gnss-sdr` a la release elegida, o (B) elaborar receta limpia en `meta-gnss-uno-q`. Evaluar complejidad/transitividad de capas, coste y mantenimiento. Preferir B si A arrastra capas de otros dispositivos (`meta-raspberrypi`, `meta-intel`, GUI, etc.) que no son necesarias.
- **ADR-003, señal:** primer test por fichero y segundo por SDR USB o red. Comparar driver directo frente a `rtl_tcp`/Osmosdr. El fichero elimina incertidumbres de RF y USB; **siempre va primero**.
- **ADR-004, user-space:** imagen headless, `systemd`, SSH, herramientas diagnósticas mínimas; decidir si usar consola serie/ADB tras migrar a Yocto. ADB de fábrica **no está garantizado** en imagen propia.
- **ADR-005, recurso CPU/memoria:** justificar opciones CMake, VOLK/NEON, número de canales, frecuencia de muestreo, RAM, buffering y límites de eMMC.
- **ADR-006, instalación:** flasheo controlado con `qdl`/imagen recomendada por BSP; preservar particiones/firmware/calibración; plan de rollback. Los comandos de un proveedor distinto no son aplicables automáticamente.
- **ADR-007, licencias:** identificar licencias efectivas y obligaciones de distribución del binario, recetas, GNU Radio, VOLK y firmware, a partir de sus archivos SPDX/COPYING actuales.

### Restricciones obligatorias

- Nunca configurar `LAYERSERIES_COMPAT` arbitrariamente solo para eliminar un error. Es un indicador de compatibilidad que exige prueba real.
- No introducir `SRCREV = "${AUTOREV}"` en entregas reproducibles.
- No usar `-march=native` en cross-compilation. Elegir tuning del BSP o flags AArch64 admitidos y medir antes de afinar.
- No habilitar todos los front-ends de GNSS-SDR por defecto.
- No fingir que GPU/Hexagon DSP/HTP aceleran GNSS-SDR. Solo mencionarlos como investigación futura con evidencia.
- No equiparar «compila» con «resuelve PVT en tiempo real».
- No iniciar un flasheo destructivo sin autorización del propietario de la placa.

---

## 4. Entregables exigidos: repositorio de proyecto

Crear esta estructura, adaptándola solo cuando el KAS/BSP verificado lo requiera:

```text
uno-q-gnss-sdr/
├── README.md
├── LICENSES.md
├── kas/
│   ├── uno-q-upstream.yml         # construcción base reproducible
│   └── uno-q-gnss-sdr.yml         # overlay del producto
├── meta-gnss-uno-q/
│   ├── conf/layer.conf
│   ├── recipes-core/images/gnss-uno-q-image.bb
│   ├── recipes-apps/gnss-sdr/
│   │   ├── gnss-sdr_<version>.bb   # o .bbappend si procede
│   │   └── files/
│   │       ├── gnss-sdr.service
│   │       ├── gnss-sdr.env
│   │       └── udev-rtl-sdr.rules  # solo si se necesita
│   └── recipes-apps/gnss-config/
│       ├── gnss-config.bb
│       └── files/
│           ├── gps-l1ca-file.conf
│           └── gps-l1ca-live.conf
├── scripts/
│   ├── bootstrap-host.sh
│   ├── build-base.sh
│   ├── build-gnss-image.sh
│   ├── inspect-bitbake.sh
│   ├── validate-image.sh
│   ├── diagnose-board.sh
│   ├── capture-board-info.sh
│   ├── benchmark-gnss.sh
│   └── flash-guarded.sh           # por defecto dry-run, sin borrado
├── tests/
│   ├── test-recipe-metadata.sh
│   ├── test-configs.sh
│   ├── test-pvt-output.py
│   └── fixtures/README.md         # no subir muestras grandes o privadas
├── docs/
│   ├── research.md
│   ├── setup-host.md
│   ├── build.md
│   ├── board-access.md
│   ├── rf-frontends.md
│   ├── flashing-and-recovery.md
│   ├── validation-report.md
│   ├── known-issues.md
│   ├── decisions/
│   └── logs/                      # muestras resumidas de log
└── manifests/
    ├── revisions.lock            # URLs, ramas y commit SHAs
    └── build-manifest.txt
```

**Nota:** los nombres de receta y de fichero son una **estructura objetivo**, no una afirmación de que ya sean sintácticamente válidos. Debes crear contenido BitBake real, resolver variables `S`, `B`, `SRC_URI`, `SRCREV`, `LIC_FILES_CHKSUM`, `DEPENDS`, `PACKAGECONFIG`, `RDEPENDS`, `FILES`, `inherit cmake/pkgconfig` y ejecutar pruebas de parseo para verificarlo.

---

## 5. Fases de trabajo y criterios de aceptación

### Fase 0. Inspección y congelación del entorno

1. Revisar el README/AGENTS de Qualcomm y la configuración `ci/uno-q.yml` con sus `includes`.
2. Verificar el soporte de `uno-q` en la rama elegida, la configuración del kernel y la imagen que CI construye.
3. Verificar versión Yocto, versión del compilador, `TUNE_FEATURES`, ABI, arquitectura, glibc/musl y distribución de referencia.
4. Consultar OE Layer Index y los `layer.conf` de cada capa añadida. Registrar compatibilidad.
5. Localizar la receta GNSS-SDR más reciente mantenida en `meta-gnss-sdr`; documentar todas sus dependencias. Compararla con las dependencias actuales en GNSS-SDR `main` o un tag estable.
6. Seleccionar y fijar commits. Elaborar una tabla reproducible.
7. Emitir `docs/research.md` y los ADRs. No cambiar el BSP sin justificación.

**Hecho cuando:** existen hashes precisos y una arquitectura/estrategia explicada, sin errores de compatibilidad ocultados.

### Fase 1. Construir y validar el BSP Qualcomm sin GNSS-SDR

Comando **oficial orientativo**, desde un host Linux con `kas-container` operativo:

```bash
git clone https://github.com/qualcomm-linux/meta-qcom-arduino.git -b main
kas-container build meta-qcom-arduino/ci/uno-q.yml
```

La receta oficial también permite un fragmento adicional `ci/qcom-distro.yml`. Comprobar si conviene. Este comando demuestra el **punto de partida**, pero para el proyecto final crear un `kas/uno-q-upstream.yml` con ramas y revisiones congeladas.

Tareas:

- Preparar el host (Docker/Podman, grupo de permisos, `kas-container`, disco, RAM y swap).
- Dimensionar almacenamiento para dependencias y artefactos; gestionar y reutilizar `DL_DIR` y `SSTATE_DIR` fuera del árbol efímero.
- Confirmar que se generan artefactos bajo `tmp/deploy/images/uno-q` o la ruta que realmente indique el BSP.
- Guardar `bitbake -e`, lista de capas, manifiesto y hash de imagen.
- Determinar el formato de imagen realmente desplegable: **no inventar** nombre del `.wic`, `.qcomflash` o programador; consultar el resultado.

**Hecho cuando:** BitBake completa imagen base, se verifican los artefactos y hay un registro de compilación y dependencias.

### Fase 2. Crear capa Yocto del producto

1. Crear `meta-gnss-uno-q` sin modificar el repositorio upstream.
2. Declarar `LAYERSERIES_COMPAT` para la release que se haya demostrado compatible.
3. Extender el manifiesto KAS de Qualcomm de forma reproducible, con la capa local y, si es necesario, `meta-openembedded` (`meta-oe`, `meta-python`, `meta-networking`, etc.) de la **misma** release.
4. Diseñar `gnss-uno-q-image` a partir de una imagen base adecuada, añadiendo `IMAGE_INSTALL` solo con los paquetes necesarios.
5. Incluir SSH, diagnósticos USB, conectividad básica, sincronización temporal, certificados TLS y herramientas mínimas. Verificar nombres de recetas reales.
6. Mantener bootloader, firmware de Qualcomm, device tree, Wi-Fi y servicios específicos de plataforma **del BSP**.
7. Si la placa usa lógica de A/B boot-success / `qbootctl`, comprobar que la nueva imagen realiza el marcado de arranque correcto: de lo contrario una imagen que arranca inicialmente puede fallar tras reinicios. No copiar ciegamente supuestos desde otros proyectos.
8. Crear pruebas de metadata (`bitbake -p`, `bitbake-layers show-layers`, `bitbake-layers show-recipes`), reproducibles desde un script.

**Hecho cuando:** la imagen del producto construye sin GNSS-SDR o con un paquete de prueba y arranca en un entorno real o simulado donde sea posible (las validaciones de hardware se marcan por separado).

### Fase 3. Integrar GNSS-SDR en BitBake

**Priorizar la reutilización, sin arrastrar dependencias innecesarias.** Si `meta-gnss-sdr` no tiene rama compatible con la release elegida, adaptar su receta en una capa propia respetando licencias y atribución, o escribir una receta CMake mantenible desde cero.

Requisitos de la receta:

- Código de GNSS-SDR fijado a commit/tag revisado (no `AUTOREV`).
- Dependencias de compilación y tiempo de ejecución **realmente** requeridas por esa revisión: revisar GNU Radio runtime, VOLK, `volk_gnsssdr`, Boost, FFTW, Armadillo, protobuf, gflags/glog/Abseil y otras dependencias detectadas, sin asumir listas históricas.
- Evitar descargas dinámicas ejecutadas por CMake o `FetchContent` fuera de las tareas de `do_fetch`. Si el build necesita librerías externas, incorporarlas como recetas o fuentes declaradas, respetando las políticas de Yocto.
- Compilar para `aarch64` con la toolchain Yocto. Emplear `pkg-config` y toolchain files del entorno, no rutas hardcoded del host.
- Opciones CMake explícitas (los nombres deben verificarse en el `CMakeLists.txt` fijado): `ENABLE_UHD=OFF` si no se usa; `ENABLE_OSMOSDR=ON` solo con dependencias presentes si se selecciona RTL-SDR; `ENABLE_PLUTOSDR=OFF` salvo que se use; desactivar pruebas grandes, GUI, simuladores, backends aceleradores no utilizados y descargas innecesarias.
- **Separar variantes**: construcción mínima de fichero I/Q y construcción con frontend vivo. Si el driver USB complica el build, la variante offline debe compilar independientemente.
- Instalar binarios en ubicaciones FHS (`/usr/bin` o equivalente) y configs bajo `/etc/gnss-sdr/`; datos y logs persistentes bajo `/var/lib/gnss-sdr/` y `/var/log/gnss-sdr/` o `journald`.
- Generar metadatos SBOM/licencias y evitar fuentes o firmware redistribuidos sin permiso.

**Hecho cuando:** `bitbake gnss-sdr` compila, empaqueta, resuelve dependencias y el ejecutable es AArch64 verificable mediante `file`/`readelf`; no se limita a `do_configure`.

### Fase 4. Configuración y pruebas con ficheros I/Q

Generar una configuración GPS L1 C/A validada contra los ejemplos oficiales del **mismo commit** de GNSS-SDR. Incluir al menos:

- Fuente `File_Signal_Source` (o implementación exacta soportada por la revisión).
- Tipo de muestra: `ibyte`, `ishort`, `gr_complex`, etc. **sin elegirlo a ciegas**.
- Frecuencia de muestreo `fs`, frecuencia central/IF y número de canales GNSS.
- Acondicionamiento y posible resampling, adquisición, tracking, decodificación NAV, observables y PVT.
- Tasas de salida, ruta RINEX/NMEA (según implementación real), logging y parada ordenada.

**Nunca generar un fichero I/Q fingido y afirmar que se ha obtenido un fix.** Si no hay muestra real, la prueba debe distinguir: (a) parser de configuración, (b) carga de muestras, (c) adquisición, (d) tracking, (e) decodificación, (f) PVT. Cada fase tiene un resultado independiente.

#### Matriz de ensayos inicial

| Prueba | Entrada | Evidencia esperada |
|---|---|---|
| T01 | `gnss-sdr --version`/ayuda según CLI real | binario instalado y ejecutable |
| T02 | fichero I/Q pequeño con formato conocido | lectura correcta y fin de fichero ordenado |
| T03 | captura GPS L1 C/A válida | satélites adquiridos y C/N0, si la SNR lo permite |
| T04 | captura suficientemente larga con navegación | tracking, efemérides y observables |
| T05 | dataset con fix de referencia | PVT, error y logs frente a referencia |
| T06 | misma captura en PC Linux x86_64 | comparación funcional y de rendimiento |
| T07 | repetición de T03-T05 con herramientas de perfilado | consumo CPU, memoria y latencia |

El fichero I/Q debe ir acompañado de `tests/fixtures/README.md` especificando: derechos de uso, hash SHA256, bytes, muestreo, IF/centro, fecha, formato, referencia y duración. No incluir grabaciones privadas ni de tamaño grande en el repositorio.

**Hecho cuando:** GNSS-SDR corre en la imagen con un dataset real y existe un informe de evidencia para cada etapa; la resolución PVT solo se da por superada si se observa efectivamente.

### Fase 5. Interfaz RF real y USB host

1. **Comprobar primero en Debian de fábrica**, si la placa sigue intacta, que el SDR enumera, consume corriente admisible y ofrece streaming estable. Conservar salida de `lsusb`, `dmesg`, `uname -a` y pruebas de tasa de I/Q. Este paso es útil pero no sustituye la integración Yocto.
2. Identificar cómo conectar el RTL-SDR al USB-C del UNO Q: cable/Hub USB-C host compatible, alimentación externa adecuada y VBUS activo. Validar que la placa está en **host**, no en modo **device**.
3. Consultar la guía de Arduino para forzar host en condiciones de alimentación VIN/5V. **No improvisar puentes JCTL:** identificar el pinout y revisar fuente oficial antes de aplicar tensión o cerrar contactos.
4. Confirmar drivers kernel (`dvb_usb_rtl28xxu` vs acceso libusb), reglas udev, permisos y conflicto con drivers DVB que reclaman el dispositivo. Elegir la solución mínima correcta para el backend usado.
5. Asegurar antena GNSS, LNA/filtro adecuado, referencia RF y ganancia, y valorar el efecto de la corriente del RTL-SDR y del LNA sobre la fuente de alimentación.
6. Elegir entre `Osmosdr_Signal_Source` o `RtlTcp_Signal_Source` conforme a soporte real en la revisión compilada. Para `rtl_tcp`, justificar throughput, almacenamiento, interfaz de red y latencia; no suponer que se necesitan opciones de Osmosdr si se usa `rtl_tcp`.
7. Medir errores USB (overruns/dropouts), bytes/s, pérdida de muestras, potencia/temperatura y precisión de frecuencia de oscilador RTL.
8. Mantener la configuración live independiente de la configuración file.

**Hecho cuando:** se mantiene streaming de I/Q sin pérdidas inaceptables, GNSS-SDR adquiere/tracks con RF real y se registran las limitaciones de PVT/tiempo real.

### Fase 6. Servicio, observabilidad y operación autónoma

- Empaquetar un servicio `systemd` que ejecute GNSS-SDR con un usuario dedicado si el acceso a dispositivos y las capacidades lo permiten.
- Fichero de entorno editable en `/etc/default/gnss-sdr` o equivalente, con selección de configuración/captura y dispositivo.
- Reinicio controlado si falla; **evitar bucles de reinicio** cuando falta SDR. Dar prioridad a logs diagnósticos.
- Habilitación/deshabilitación sin recompilar toda la imagen.
- Logs por `journalctl`, health check, métricas de CPU/RAM/temperatura/USB, uso de eMMC, uptime, tasa de salida PVT.
- Guardar ejecuciones de diagnóstico con timestamps y versión de imagen/configuración.
- Opcional: emitir NMEA por TCP/UDP o archivo, únicamente si GNSS-SDR lo soporta de forma verificada.
- Proteger accesos de red; no habilitar servicios expuestos de forma insegura por defecto.

**Hecho cuando:** reiniciar la placa arranca el servicio en condiciones correctas y las condiciones de error son interpretables y recuperables.

### Fase 7. Benchmark y plan de optimización

Medir, no presumir, capacidad del Cortex-A53:

- Procesamiento offline: ratio `duración de señal / tiempo de CPU o wall-clock`, RSS máxima, picos CPU, swaps, fallo de asignación y frecuencia efectiva.
- Tiempo real: porcentaje de CPU por core, backlog, saturación USB, dropouts, intervalos sin PVT, utilización térmica, throttling, tasas de log y disco.
- Comparar configuraciones: número de canales, `fs`, tipo de muestra, VOLK kernels seleccionados, NEON cuando proceda, FFTW, resampling y prioridades del servicio.
- Ejecutar `volk_gnsssdr_profile` si la utilidad está empaquetada y procede; registrar qué kernels se seleccionaron y volver a validar resultados GNSS.
- Evitar sobrecomprometer 2 GB de RAM: monitorizar `oom-killer`, page cache y tamaño de buffers.
- No afirmar rendimiento hard real-time por ejecutar Linux. Documentar el jitter y límites.
- **Objetivo pragmático:** GPS L1 C/A de pocos canales primero; Galileo E1, multibanda y aceleración solo después de obtener benchmarks.

**Hecho cuando:** tabla comparativa y gráficas o CSV reproducibles, con declaración clara «funciona en tiempo real» / «funciona solo offline» / «no probado».

---

## 6. Flasheo, protección de eMMC y recuperación (máxima prioridad)

**Regla absoluta: no reescribir el dispositivo sin validación previa y autorización expresa.** El programa que prepare flasheo debe ser `--dry-run` por defecto y mostrar qué particiones se escriben.

Antes de flashear:

1. Extraer inventario del dispositivo de fábrica (modelo exacto, RAM/eMMC, kernel, particiones GPT, seriales no sensibles en informe público, Wi-Fi y conectividad, servicios del MCU, versión de firmware).
2. Copiar archivos del usuario y configuraciones importantes. Preparar y conservar una **imagen original de recuperación** y las instrucciones oficiales del fabricante.
3. Identificar `EDL / Qualcomm 9008`, programador firmado y herramienta `qdl` adecuada al UNO Q. Confirmar si el BSP genera estructura `qcomflash`, `rawprogram*.xml` y `patch*.xml`; **no usar archivos de RB3 Gen 2 para UNO Q**.
4. Revisar con especial atención particiones de calibración, persistencia, MAC/datos de identidad, firmware firmados y `userdata` que deben conservarse.
5. Validar cómo el bootloader selecciona imagen/kernel y si se requiere marcar como exitoso el arranque de un slot A/B.
6. Preparar consola serie con adaptador **1,8 V**, nunca conectar uno 3,3 V sin traductor adecuado.
7. Inspeccionar `qdl` y reglas udev; impedir interferencias de `ModemManager` cuando corresponda.
8. Validar voltaje y fuente de alimentación durante la escritura de eMMC; evitar desconexiones.

Para entrar en EDL: **verificar con la documentación actual y pinout exacto** la función de `USB_BOOT`/JCTL y comprobar enumeración con `lsusb` (USB VID:PID Qualcomm 05c6:9008). No confundir la maniobra del modo EDL con la del modo USB host.

Tras flashear:

- Retirar los puentes de boot que no deban permanecer, reiniciar y observar kernel por serie.
- Validar rootfs, red, almacenamiento, USB host, firmware y salud del MCU por separado.
- Reiniciar repetidas veces para comprobar persistencia/estado A/B y no solo un primer boot exitoso.
- Documentar recuperación si la imagen no arranca, conservando estado del dispositivo y evitando reflasheos indiscriminados.

**Importante:** algunas guías de terceras partes documentan un modelo de despliegue que solo reescribe `efi` y `rootfs` mientras mantiene el firmware. Puede servir de referencia para estudiar la distribución de particiones, pero **el proyecto debe validar las instrucciones específicas del `meta-qcom-arduino` seleccionado antes de aplicar ese criterio**.

---

## 7. Ejemplo de verificación de entorno y comandos requeridos

Implementa scripts que encapsulen los comandos con mensajes claros y códigos de error. Al menos comprobar estas familias de comandos (si están disponibles):

```bash
# Host: inspección de revisiones, antes de escoger release
git ls-remote --heads https://github.com/qualcomm-linux/meta-qcom-arduino.git
git ls-remote --heads https://github.com/carlesfernandez/meta-gnss-sdr.git

# Entorno de BitBake, cuando KAS esté preparado:
bitbake-layers show-layers
bitbake-layers show-recipes gnss-sdr
bitbake -p
bitbake -e gnss-sdr  # guardar y filtrar SRCREV, DEPENDS, TUNE_FEATURES, PACKAGECONFIG

# Board (solo lectura):
uname -a
cat /proc/meminfo | head
lsusb
lsblk -o NAME,SIZE,TYPE,MOUNTPOINTS
findmnt
systemctl --failed

dmesg | tail -n 80

# Diagnóstico GNSS-SDR: validar el CLI real antes de implementar tests
gnss-sdr --version
gnss-sdr --help

# Servicio, si se ha instalado:
systemctl status gnss-sdr
journalctl -u gnss-sdr -n 100 --no-pager
```

**No** copiar ni ejecutar la sección `bitbake` en un host fuera de su shell/contendor de compilación. Documentar cómo entrar en la shell correcta con KAS. Las opciones de CLI `--version`/`--help` deben verificarse en el binario real; si difieren, corregir los tests.

---

## 8. Pruebas cuantitativas y evidencias

Proporcionar una tabla en `docs/validation-report.md` como esta:

| ID | Criterio | Método | Resultado | Evidencia |
|---|---|---|---|---|
| B01 | KAS/BSP resuelve | build base | PASS/FAIL/NOT RUN | log y hash |
| B02 | Metadata Yocto | `bitbake -p` | PASS/FAIL/NOT RUN | log |
| B03 | GNSS-SDR cross-build | `bitbake gnss-sdr` | PASS/FAIL/NOT RUN | paquetes |
| B04 | Imagen generada | `bitbake gnss-uno-q-image` | PASS/FAIL/NOT RUN | manifest/hash |
| H01 | Arranque real UNO Q | consola UART | PASS/FAIL/NOT RUN | boot log |
| H02 | Reboot repetido / slot | 5+ reinicios | PASS/FAIL/NOT RUN | log |
| H03 | USB host | `lsusb` + streaming | PASS/FAIL/NOT RUN | log |
| G01 | GNSS-SDR ejecuta | binario ARM64 | PASS/FAIL/NOT RUN | CLI |
| G02 | IQ offline | fichero válido | PASS/FAIL/NOT RUN | log |
| G03 | Tracking real | satélites/SNR/CN0 | PASS/FAIL/NOT RUN | log |
| G04 | PVT GPS L1 C/A | comparativa referencia | PASS/FAIL/NOT RUN | CSV |
| G05 | RF real | prueba continuada | PASS/FAIL/NOT RUN | log |
| P01 | CPU, RAM y dropouts | benchmark | PASS/FAIL/NOT RUN | CSV |
| O01 | Servicio/systemd | arranque/paro | PASS/FAIL/NOT RUN | journal |
| R01 | Recovery documentada | simulación/manual | PASS/FAIL/NOT RUN | instrucciones |

Conservar comandos exactos, salida abreviada, fecha, versión, SHA de fuentes e identificación no sensible de HW. Usar `NOT RUN` cuando no haya placa o muestras, **nunca inventar PASS**.

---

## 9. Extensiones propuestas (NO BLOQUEANTES)

Solo después de alcanzar el MVP:

1. Galileo E1, y eventualmente GPS/Galileo multiconstelación.
2. Front-end GNSS-SRP/u otro digitalizador propio: incorporar una `SignalSource` apropiada a su transporte y formato real, documentando reloj y latencia.
3. Exportación de observables GNSS-SDR (RINEX/protobuf u otra interfaz validada) para procesamiento posterior en MATLAB/Python.
4. Monitor local PVT accesible por red, con tiempo, satélites, CN0, TTFF y estado del receptor; no diseñar una GUI completa para el MVP.
5. Indicador ligero mediante STM32U585/Zephyr y LED matrix, usando la interfaz Linux–MCU comprobada y sin impedir funcionamiento GNSS cuando el MCU no responde.
6. Sincronización horaria, PPS y evaluación de oscilador del SDR; no asumir PPS en hardware que no lo exponga.
7. Optimización NEON/VOLK, número de canales y grabación eficiente de datos; evaluar offload solo con evidencia de viabilidad.
8. OSNMA y EGNOS/HAS después de verificar soporte real en el GNSS-SDR fijado y disponer de las señales y datasets apropiados.

---

## 10. Forma de trabajar que espero del agente de IA

**No te detengas en un plan abstracto.** Ejecútalo en este orden:

1. Abre y lee las fuentes de verdad; registra commits y compatibilidad.
2. Crea repositorio, manifiestos KAS, la capa propia, recetas y scripts reales.
3. Ejecuta parseo BitBake, build de receta y build de imagen cuando el entorno disponga de CPU, disco y red.
4. Itera hasta resolver errores de compilación; publica los fallos concretos si el entorno no permite continuar.
5. Incluye configuraciones GNSS-SDR mínimas **validadas** contra el commit elegido y ejemplos documentados de cómo indicar un I/Q real.
6. No solicites permisos para realizar lectura, generación de código o compilación no destructiva; sí pide confirmación antes de flashear, borrar datos o modificar el hardware.
7. Cada vez que encuentres una incompatibilidad, explica causa y solución concreta y añade una prueba para evitar regresiones.
8. Mantén la construcción offline totalmente funcional aunque no haya hardware USB SDR.
9. Al final entrega la estructura, archivos completos, instrucciones copy-paste, resultados PASS/FAIL/NOT RUN, limitaciones y los **tres siguientes pasos exactos** del técnico que conectará la placa.
10. Si una dependencia upstream es obsoleta, no ocultes el problema: presenta el error, propone un parche limpio o una receta sustituta y vuelve a construir.

### Cómo reportar el estado

Al final de cada fase informa, de forma breve:

```text
FASE:
DECISIÓN:
ARCHIVOS MODIFICADOS:
COMANDOS EJECUTADOS:
PRUEBAS:
RESULTADO: PASS | FAIL | NOT RUN
EVIDENCIA:
BLOQUEO (si existe):
SIGUIENTE ACCIÓN:
```

### Definition of Done del proyecto MVP

- [ ] Imagen propia Yocto para `MACHINE = "uno-q"` reproducible con KAS y commits congelados.
- [ ] Capa de producto separada del BSP Qualcomm.
- [ ] GNSS-SDR AArch64 empaquetado en la imagen (sin instalarlo con `apt`).
- [ ] Configuración GPS L1 C/A offline que procesa un I/Q real de formato conocido.
- [ ] Hardware USB host, fuente SDR y receptor en tiempo real probados (si hay placa/front-end accesibles), o etiquetados `NOT RUN` con procedimiento concreto.
- [ ] Servicio `systemd`, logs y configuración persistente.
- [ ] Plan de recuperación, seguridad de flasheo y backup documentados.
- [ ] Medidas de rendimiento con trazabilidad a versión, señal de entrada y hardware.
- [ ] README que permita a un tercero reproducir la construcción desde un host Linux limpio.

## 11. Primer trabajo inmediato (haz esto ahora)

1. Inspecciona `meta-qcom-arduino` (`main` y `wrynose`) y `meta-qcom` para determinar el KAS mínimo del UNO Q.
2. Inspecciona `meta-gnss-sdr` y sus ramas; **no uses `master` para construir una release sin una evaluación explícita**, ya que su README lo desaconseja.
3. Revisa el `CMakeLists.txt` de GNSS-SDR fijado y define una receta mínima *file-only*.
4. Construye el esqueleto completo de `uno-q-gnss-sdr` y valida al menos sintaxis de configuración y parseo de BitBake.
5. Si tienes entorno de compilación utilizable, intenta la compilación; si no, deja todos los archivos listos y una lista precisa de las primeras instrucciones de ejecución.

**Resultado final que buscamos:** un pequeño receptor GNSS real implementado en Arduino UNO Q con una distribución **Yocto** mantenible, no una simple demo de escritorio y no una imagen Debian disfrazada.
