package com.metlp.widget

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

data class LiquidityBin(val binId: Int, val liquidity: Float, val side: String)
data class PositionCard(
    val pair: String,
    val balanceUsd: Double,
    val feesUsd: Double,
    val pnlUsd: Double,
    val pnlPercent: Double,
    val inRange: Boolean,
    val bins: List<LiquidityBin>,
    val activeBinId: Int?,
)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { MetLpApp() }
    }
}

@Composable
private fun MetLpApp() {
    var apiUrl by remember { mutableStateOf("") }
    var wallet by remember { mutableStateOf("") }
    var token by remember { mutableStateOf("") }
    var positions by remember { mutableStateOf(samplePositions()) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    MaterialTheme(colorScheme = darkColorScheme(background = Color(0xFF171620), surface = Color(0xFF211F2E))) {
        Column(Modifier.fillMaxSize().background(Color(0xFF171620)).padding(16.dp)) {
            Text("MetLP", color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.Bold)
            Text("Open positions", color = Color(0xFFAAA5BE), fontSize = 14.sp)
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(apiUrl, { apiUrl = it }, label = { Text("API URL (https://your-domain)") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(wallet, { wallet = it }, label = { Text("Wallet address") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(token, { token = it }, label = { Text("API token") }, modifier = Modifier.fillMaxWidth())
            Button(
                onClick = {
                    loading = true; error = null
                    loadPositions(apiUrl, wallet, token, { positions = it; loading = false }, { error = it; loading = false })
                },
                enabled = !loading && apiUrl.isNotBlank() && wallet.isNotBlank() && token.isNotBlank(),
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            ) { Text(if (loading) "Refreshing..." else "Refresh") }
            error?.let { Text(it, color = Color(0xFFFF8A8A), modifier = Modifier.padding(top = 6.dp)) }
            Spacer(Modifier.height(10.dp))
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(positions) { PositionRow(it) }
            }
        }
    }
}

@Composable
private fun PositionRow(position: PositionCard) {
    Surface(color = Color(0xFF211F2E), shape = MaterialTheme.shapes.small) {
        Row(Modifier.fillMaxWidth().height(116.dp).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(position.pair, color = Color.White, fontWeight = FontWeight.Bold)
                Metric("Balance", "$${"%.2f".format(position.balanceUsd)}")
                Metric("Fees", "$${"%.2f".format(position.feesUsd)}")
                val pnlColor = if (position.pnlUsd >= 0) Color(0xFF52D39B) else Color(0xFFFF7777)
                Text("PnL ${"%+.2f".format(position.pnlUsd)} (${"%+.1f".format(position.pnlPercent)}%)", color = pnlColor, fontSize = 12.sp)
                Text(if (position.inRange) "IN RANGE" else "OUT OF RANGE", color = if (position.inRange) Color(0xFF5DD8E9) else Color(0xFFFFC46B), fontSize = 10.sp)
            }
            LiquidityShape(position, Modifier.width(164.dp).fillMaxHeight())
        }
    }
}

@Composable
private fun Metric(label: String, value: String) {
    Text("$label  $value", color = Color(0xFFC9C4D8), fontSize = 12.sp)
}

@Composable
private fun LiquidityShape(position: PositionCard, modifier: Modifier) {
    Canvas(modifier) {
        if (position.bins.isEmpty()) return@Canvas
        val step = size.width / position.bins.size
        val activeIndex = position.bins.indexOfFirst { it.binId == position.activeBinId }
        position.bins.forEachIndexed { index, bin ->
            if (bin.liquidity <= 0f) return@forEachIndexed
            val height = (size.height - 20.dp.toPx()) * bin.liquidity
            drawLine(
                color = if (bin.side == "left") Color(0xFF16C5D9) else Color(0xFF7950F2),
                start = Offset(index * step + step / 2, size.height),
                end = Offset(index * step + step / 2, size.height - height),
                strokeWidth = (step * 0.65f).coerceAtLeast(1f),
            )
        }
        if (activeIndex >= 0) {
            val x = activeIndex * step + step / 2
            drawLine(Color.White, Offset(x, 0f), Offset(x, size.height), strokeWidth = 2.dp.toPx(), pathEffect = androidx.compose.ui.graphics.PathEffect.dashPathEffect(floatArrayOf(7f, 7f)))
            drawCircle(Color.White, 4.dp.toPx(), Offset(x, 8.dp.toPx()), style = Stroke(1.dp.toPx()))
        }
    }
}

private fun loadPositions(url: String, wallet: String, token: String, success: (List<PositionCard>) -> Unit, failure: (String) -> Unit) {
    thread {
        try {
            val connection = (URL("${url.trimEnd('/')}/api/positions?wallet=$wallet&limit=5").openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"; setRequestProperty("Authorization", "Bearer $token"); connectTimeout = 10_000; readTimeout = 15_000
            }
            val body = connection.inputStream.bufferedReader().use { it.readText() }
            val json = JSONObject(body)
            val data = json.getJSONArray("positions")
            val parsed = List(data.length()) { index ->
                val item = data.getJSONObject(index); val liquidity = item.optJSONObject("liquidity"); val bins = liquidity?.optJSONArray("bins")
                PositionCard(
                    pair = "${item.getJSONObject("pair").optString("base")}/${item.getJSONObject("pair").optString("quote")}",
                    balanceUsd = item.optDouble("totalBalanceUsd"), feesUsd = item.optDouble("collectibleFeesUsd"),
                    pnlUsd = item.optDouble("pnlUsd"), pnlPercent = item.optDouble("pnlPercent"), inRange = item.optBoolean("inRange"),
                    activeBinId = liquidity?.optInt("activeBinId"),
                    bins = List(bins?.length() ?: 0) { binIndex -> bins!!.getJSONObject(binIndex).let { LiquidityBin(it.optInt("binId"), it.optDouble("liquidity").toFloat(), it.optString("side")) } },
                )
            }
            Handler(Looper.getMainLooper()).post { success(parsed) }
        } catch (error: Exception) { Handler(Looper.getMainLooper()).post { failure(error.message ?: "Could not load positions") } }
    }
}

private fun samplePositions() = listOf(
    PositionCard("SOL/USDC", 256.80, 4.24, 18.62, 7.8, true, (0..34).map { LiquidityBin(it, (if (it < 18) it else 34 - it).coerceAtLeast(1) / 18f, if (it < 18) "left" else "right") }, 18),
    PositionCard("YOTS/SOL", 74.13, 0.86, -2.19, -2.9, false, (0..34).map { LiquidityBin(it, (34 - it) / 34f, if (it < 23) "left" else "right") }, 23),
)
