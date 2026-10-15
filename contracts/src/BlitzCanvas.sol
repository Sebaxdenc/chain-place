// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title BlitzCanvas — lienzo colaborativo on-chain para Monad
/// @notice Un slot de storage por pixel, a proposito. Ver NOTA DE DISEÑO abajo.
///
/// ╔══════════════════════════════════════════════════════════════════════════╗
/// ║ NOTA DE DISEÑO: por que un slot por pixel y no 32 pixeles por slot       ║
/// ╠══════════════════════════════════════════════════════════════════════════╣
/// ║ Monad ejecuta transacciones en paralelo de forma optimista: las corre a  ║
/// ║ la vez y RE-EJECUTA las que leyeron estado que una tx anterior escribio. ║
/// ║                                                                          ║
/// ║ Si empaquetaramos 32 pixeles en un slot (lo "gas-optimo" en Ethereum),   ║
/// ║ dos personas pintando pixeles vecinos escribirian el MISMO slot =>       ║
/// ║ conflicto => re-ejecucion => el lienzo se serializa y perdemos el        ║
/// ║ paralelismo que es justo lo que queremos demostrar.                      ║
/// ║                                                                          ║
/// ║ Un slot por pixel = escrituras independientes = cero contencion.         ║
/// ╚══════════════════════════════════════════════════════════════════════════╝
contract BlitzCanvas {
    /// @dev 128 no es un numero arbitrario: Monad calienta el storage en
    ///      PAGINAS DE 128 SLOTS CONSECUTIVOS. Con un lienzo de 128 de ancho e
    ///      indice = y*128 + x, cada FILA del lienzo ocupa exactamente una
    ///      pagina. Pintar un trazo horizontal paga el coste de pagina (8.100
    ///      gas) UNA sola vez en lugar de una por pixel.
    uint32 public constant WIDTH = 128;
    uint32 public constant HEIGHT = 128;
    uint32 public constant TOTAL = WIDTH * HEIGHT; // 16.384

    /// @dev DEBE declararse primero. Solidity le asigna el slot 0, y 0 es
    ///      multiplo de 128, asi que el array queda ALINEADO A PAGINA. Si
    ///      pusieras otra variable de storage antes, el array arrancaria
    ///      desplazado y cada fila cruzaria dos paginas, duplicando el coste
    ///      de acceso en frio de los trazos. No muevas esta linea.
    ///
    ///      Empaquetado DENTRO de cada slot (nunca entre pixeles):
    ///        bits   0..7    color  (indice de paleta, 0-255)
    ///        bits   8..167  painter (address, 160 bits)
    ///        bits 168..215  timestamp (uint48)
    uint256[16384] private _pixels;

    /// @notice Ultimo instante en que cada address pinto.
    /// @dev Cada quien escribe SU PROPIO slot (keccak de su address) => esto
    ///      tampoco genera contencion entre pintores distintos.
    mapping(address => uint64) public lastPaintAt;

    /// @notice Segundos de espera entre pintadas. 0 = sin limite.
    /// @dev Inmutable, no storage: leerlo es gratis (va en el bytecode).
    ///      Para la demo despliega con 0 (quieres TPS alto). Subelo solo si
    ///      aparece griefing. Ojo: TIMESTAMP en Monad tiene granularidad de
    ///      SEGUNDOS y los bloques son de 300ms, asi que 3-4 bloques comparten
    ///      timestamp. Un cooldown de 1 es, en la practica, "1 pixel por ~4
    ///      bloques".
    uint64 public immutable cooldown;

    /// @notice Se emite por cada pixel pintado. Es la UNICA fuente de verdad
    ///         para el feed en vivo: el indexador escucha esto por WebSocket.
    /// @dev `idx` y `painter` van indexados para poder filtrar por zona o por
    ///      pintor sin descargar todo. `color` va en data (es 1 byte, no vale
    ///      la pena gastar un topic).
    event Painted(uint32 indexed idx, uint8 color, address indexed painter);

    error OutOfBounds(uint32 idx);
    error OnCooldown(uint64 availableAt);
    error LengthMismatch();
    error EmptyBatch();

    constructor(uint64 cooldownSeconds) {
        cooldown = cooldownSeconds;
    }

    /// @notice Pinta un pixel. Este es el camino caliente: un toque = una tx.
    function paint(uint32 idx, uint8 color) external {
        if (idx >= TOTAL) revert OutOfBounds(idx);
        _tick();
        _write(idx, color);
    }

    /// @notice Pinta varios pixeles en UNA transaccion (un trazo).
    /// @dev Si los indices son contiguos en la misma fila, comparten pagina de
    ///      storage y el coste por pixel se desploma. Ver el test
    ///      test_GasReport_RowVsColumn: una fila es ~4x mas barata que una
    ///      columna del mismo tamaño.
    function paintMany(uint32[] calldata idxs, uint8[] calldata colors) external {
        uint256 n = idxs.length;
        if (n == 0) revert EmptyBatch();
        if (n != colors.length) revert LengthMismatch();
        _tick();
        for (uint256 i; i < n; ++i) {
            uint32 idx = idxs[i];
            if (idx >= TOTAL) revert OutOfBounds(idx);
            _write(idx, colors[i]);
        }
    }

    function _tick() private {
        uint64 cd = cooldown;
        if (cd == 0) return; // con cooldown=0 no tocamos storage: mas barato
        uint64 last = lastPaintAt[msg.sender];
        uint64 nowTs = uint64(block.timestamp);
        if (last != 0 && nowTs < last + cd) revert OnCooldown(last + cd);
        lastPaintAt[msg.sender] = nowTs;
    }

    function _write(uint32 idx, uint8 color) private {
        _pixels[idx] = uint256(color)
            | (uint256(uint160(msg.sender)) << 8)
            | (uint256(uint48(block.timestamp)) << 168);
        emit Painted(idx, color, msg.sender);
    }

    /// @notice Lee un pixel desempaquetado.
    function pixel(uint32 idx)
        external
        view
        returns (uint8 color, address painter, uint48 at)
    {
        if (idx >= TOTAL) revert OutOfBounds(idx);
        uint256 p = _pixels[idx];
        return (uint8(p), address(uint160(p >> 8)), uint48(p >> 168));
    }

    /// @notice Hidratacion del lienzo completo: 1 byte por pixel.
    /// @dev Esta es la funcion que llama el indexador al arrancar. Devolver
    ///      solo el color (bytes) en vez de los slots completos baja la
    ///      respuesta de 512 KB a 16 KB. Es view, asi que el gas no se paga,
    ///      pero igual importa: los RPC imponen un limite de gas al eth_call.
    ///      16.384 slots = 128 paginas, perfectamente alineadas.
    function colorsOf(uint32 start, uint32 count)
        external
        view
        returns (bytes memory out)
    {
        if (uint256(start) + uint256(count) > TOTAL) revert OutOfBounds(start);
        out = new bytes(count);
        for (uint256 i; i < count; ++i) {
            out[i] = bytes1(uint8(_pixels[start + i]));
        }
    }
}
