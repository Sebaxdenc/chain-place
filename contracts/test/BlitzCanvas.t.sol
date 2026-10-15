// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {BlitzCanvas} from "../src/BlitzCanvas.sol";

/// @dev Tests de correccion + mediciones de gas REALES bajo el modelo de Monad
///      (requiere network = "monad" en foundry.toml).
///
///      El objetivo principal no es solo "que funcione": es sacar el numero de
///      gas que vas a poner a mano en el frontend. En Monad se cobra el
///      GAS LIMIT, no el gas usado, asi que ese numero debe ir ajustado.
contract BlitzCanvasTest is Test {
    BlitzCanvas canvas;       // cooldown = 0 (config de demo)
    BlitzCanvas canvasCd;     // cooldown = 2s (config anti-griefing)

    address alice = address(0xA11CE);
    address bob   = address(0xB0B);

    /// @dev Coste intrinseco de cualquier tx EVM. forge mide solo la llamada,
    ///      asi que hay que sumarlo para obtener el gas limit real de la tx.
    uint256 constant INTRINSIC = 21_000;

    function setUp() public {
        canvas = new BlitzCanvas(0);
        canvasCd = new BlitzCanvas(2);
        vm.warp(1_000_000);
    }

    // ───────────────────────────── correccion ─────────────────────────────

    function test_PaintStoresColorPainterAndTime() public {
        vm.prank(alice);
        canvas.paint(42, 7);

        (uint8 color, address painter, uint48 at) = canvas.pixel(42);
        assertEq(color, 7, "color");
        assertEq(painter, alice, "painter");
        assertEq(at, uint48(block.timestamp), "timestamp");
    }

    function test_RepaintOverwritesPainter() public {
        vm.prank(alice);
        canvas.paint(42, 7);
        vm.prank(bob);
        canvas.paint(42, 3);

        (uint8 color, address painter,) = canvas.pixel(42);
        assertEq(color, 3);
        assertEq(painter, bob, "el ultimo en pintar se queda el pixel");
    }

    function test_PaintEmitsEvent() public {
        // El indexador depende de este evento. Si cambia la firma, se rompe
        // el feed en vivo.
        vm.expectEmit(true, true, true, true);
        emit BlitzCanvas.Painted(42, 7, alice);
        vm.prank(alice);
        canvas.paint(42, 7);
    }

    function test_RevertsOutOfBounds() public {
        vm.expectRevert(abi.encodeWithSelector(BlitzCanvas.OutOfBounds.selector, 16_384));
        canvas.paint(16_384, 1);
    }

    function test_PaintManyWritesAll() public {
        uint32[] memory idxs = new uint32[](3);
        uint8[] memory cols = new uint8[](3);
        idxs[0] = 10; idxs[1] = 11; idxs[2] = 12;
        cols[0] = 1;  cols[1] = 2;  cols[2] = 3;

        vm.prank(alice);
        canvas.paintMany(idxs, cols);

        for (uint32 i; i < 3; ++i) {
            (uint8 c,,) = canvas.pixel(idxs[i]);
            assertEq(c, cols[i]);
        }
    }

    function test_PaintManyRevertsOnLengthMismatch() public {
        uint32[] memory idxs = new uint32[](2);
        uint8[] memory cols = new uint8[](1);
        vm.expectRevert(BlitzCanvas.LengthMismatch.selector);
        canvas.paintMany(idxs, cols);
    }

    function test_CooldownBlocksRapidRepaint() public {
        vm.prank(alice);
        canvasCd.paint(1, 1);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                BlitzCanvas.OnCooldown.selector, uint64(block.timestamp + 2)
            )
        );
        canvasCd.paint(2, 1);

        // Bob no se ve afectado por el cooldown de Alice (slots separados).
        vm.prank(bob);
        canvasCd.paint(3, 1);

        // Pasado el cooldown, Alice puede pintar de nuevo.
        vm.warp(block.timestamp + 2);
        vm.prank(alice);
        canvasCd.paint(4, 1);
    }

    function test_CooldownZeroAllowsBurst() public {
        vm.startPrank(alice);
        for (uint32 i; i < 20; ++i) canvas.paint(i, 1);
        vm.stopPrank();
    }

    function test_ColorsOfHydratesCanvas() public {
        vm.prank(alice);
        canvas.paint(0, 9);
        vm.prank(bob);
        canvas.paint(16_383, 4);

        bytes memory all = canvas.colorsOf(0, 16_384);
        assertEq(all.length, 16_384, "un byte por pixel");
        assertEq(uint8(all[0]), 9);
        assertEq(uint8(all[16_383]), 4);
        assertEq(uint8(all[500]), 0, "sin pintar = color 0");
    }

    // ──────────────────────── mediciones de gas ────────────────────────

    /// @notice El numero que necesitas para el frontend.
    function test_GasReport_SinglePaint() public {
        vm.prank(alice);
        uint256 g0 = gasleft();
        canvas.paint(5_000, 7);
        uint256 freshPaint = g0 - gasleft();

        vm.prank(bob);
        g0 = gasleft();
        canvas.paint(5_000, 8);
        uint256 overwrite = g0 - gasleft();

        console2.log("");
        console2.log("=== paint() - gas de la LLAMADA (sin intrinseco) ===");
        console2.log("  pixel virgen (slot nuevo) :", freshPaint);
        console2.log("  repintado (slot existente):", overwrite);
        console2.log("");
        console2.log("=== GAS LIMIT a poner en el frontend (+21k intrinseco) ===");
        console2.log("  peor caso  :", freshPaint + INTRINSIC);
        console2.log("  recomendado:", ((freshPaint + INTRINSIC) * 115) / 100, "(+15% margen)");
        console2.log("");

        // El pixel virgen es mas caro: paga crecimiento de estado (slot nuevo).
        assertGt(freshPaint, overwrite, "slot nuevo cuesta mas que sobrescribir");
    }

    /// @notice LA PRUEBA DE LA TESIS DE DISEÑO.
    ///         Misma cantidad de pixeles, mismo contrato, misma tx.
    ///         Una FILA (indices contiguos => 1 pagina de storage) frente a una
    ///         COLUMNA (indices separados de 128 en 128 => 1 pagina por pixel).
    ///         En Monad el acceso en frio cuesta 8.100 por PAGINA, no por slot.
    function test_GasReport_RowVsColumn() public {
        uint32 n = 32;

        uint32[] memory rowIdx = new uint32[](n);
        uint8[] memory rowCol = new uint8[](n);
        // Fila 10, columnas 0..31 → slots 1280..1311 (todos en la misma pagina)
        for (uint32 i; i < n; ++i) { rowIdx[i] = 10 * 128 + i; rowCol[i] = 5; }

        uint32[] memory colIdx = new uint32[](n);
        uint8[] memory colCol = new uint8[](n);
        // Columna 60, filas 0..31 → slots 60, 188, 316... (una pagina cada uno)
        for (uint32 i; i < n; ++i) { colIdx[i] = i * 128 + 60; colCol[i] = 5; }

        vm.prank(alice);
        uint256 g0 = gasleft();
        canvas.paintMany(rowIdx, rowCol);
        uint256 rowGas = g0 - gasleft();

        vm.prank(bob);
        g0 = gasleft();
        canvas.paintMany(colIdx, colCol);
        uint256 colGas = g0 - gasleft();

        console2.log("");
        console2.log("=== paintMany() de 32 pixeles: FILA vs COLUMNA ===");
        console2.log("  fila    (1 pagina de storage) :", rowGas);
        console2.log("  columna (32 paginas)          :", colGas);
        console2.log("  por pixel, fila   :", rowGas / n);
        console2.log("  por pixel, columna:", colGas / n);
        console2.log("  la columna cuesta x mas (en %):", (colGas * 100) / rowGas);
        console2.log("");

        assertLt(rowGas, colGas, "la fila debe ser mas barata: comparte pagina");
    }

    /// @notice Cuanto MON necesita cada celular, calculado con el gas real.
    function test_GasReport_FundingPerPhone() public {
        vm.prank(alice);
        uint256 g0 = gasleft();
        canvas.paint(9_000, 7);
        uint256 txGas = (g0 - gasleft()) + INTRINSIC;

        // Base fee minimo de Monad: 100 MON-gwei = 100 * 10^-9 MON
        uint256 minBaseFeeWei = 100 gwei;
        uint256 feePerPaintWei = txGas * minBaseFeeWei;

        console2.log("");
        console2.log("=== Fondeo por celular (a base fee minimo) ===");
        console2.log("  gas por pintada        :", txGas);
        console2.log("  coste por pintada (wei):", feePerPaintWei);
        console2.log("  pintadas con 0.1 MON   :", 0.1 ether / feePerPaintWei);
        console2.log("  pintadas con 0.5 MON   :", 0.5 ether / feePerPaintWei);
        console2.log("  pintadas con 1.0 MON   :", 1 ether / feePerPaintWei);
        console2.log("");
        console2.log("  OJO Reserve Balance: el presupuesto de gas para tx EN");
        console2.log("  VUELO es min(10 MON, balance). Con 0.5 MON caben estas");
        console2.log("  tx simultaneas en ~1.2s (k=3 bloques):");
        console2.log("  ", 0.5 ether / feePerPaintWei);
        console2.log("");
    }
}
