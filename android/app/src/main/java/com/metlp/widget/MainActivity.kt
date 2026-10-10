package com.metlp.widget

import android.content.Context
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import java.util.UUID
import kotlin.concurrent.thread

private const val API_URL = "https://metlp.duckdns.org"
private const val REFRESH_SECONDS = 15
private val Background = Color(0xFF171620)
private val Surface = Color(0xFF211F2E)
private val Muted = Color(0xFFAAA5BE)
private val Cyan = Color(0xFF16C5D9)
private val Purple = Color(0xFF7950F2)
private val Positive = Color(0xFF52D39B)
private val Negative = Color(0xFFFF7777)

data class SavedWallet(val id: String, val name: String, val address: String, val token: String)
data class LiquidityBin(val binId: Int, val liquidity: Float, val side: String)
data class PositionCard(val id: String, val pair: String, val balanceSol: Double, val feesSol: Double, val pnlSol: Double, val pnlPercent: Double, val feeTvl24hPercent: Double?, val inRange: Boolean, val bins: List<LiquidityBin>, val activeBinId: Int?)
data class WalletSummary(val investedSol: Double, val feesSol: Double, val pnlSol: Double, val positions: Int)
data class WalletPayload(val summary: WalletSummary, val positions: List<PositionCard>)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { MetLpApp() }
    }
}

@Composable
private fun MetLpApp() {
    val context = androidx.compose.ui.platform.LocalContext.current
    var wallets by remember { mutableStateOf(WalletStore.load(context)) }
    var payloads by remember { mutableStateOf<Map<String, WalletPayload>>(emptyMap()) }
    var secondsRemaining by remember { mutableIntStateOf(REFRESH_SECONDS) }
    var showAddWallet by remember { mutableStateOf(false) }
    var selectedWalletId by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    fun refreshWallet(wallet: SavedWallet, limit: Int = 30) {
        fetchWallet(wallet, limit, { payload -> payloads = payloads + (wallet.id to payload) }, { error = it })
    }

    LaunchedEffect(wallets) {
        while (true) {
            wallets.forEach { refreshWallet(it) }
            for (remaining in REFRESH_SECONDS downTo 1) {
                secondsRemaining = remaining
                delay(1_000)
            }
        }
    }

    MaterialTheme(colorScheme = darkColorScheme(background = Background, surface = Surface)) {
        val selectedWallet = wallets.find { it.id == selectedWalletId }
        if (selectedWallet == null) {
            WalletHome(wallets, payloads, secondsRemaining, { showAddWallet = true }, { selectedWalletId = it.id }, error)
        } else {
            WalletPositions(selectedWallet, payloads[selectedWallet.id], secondsRemaining, { selectedWalletId = null }, { refreshWallet(selectedWallet) })
        }
        if (showAddWallet) {
            AddWalletSheet(onDismiss = { showAddWallet = false }) { name, address, token ->
                val wallet = SavedWallet(UUID.randomUUID().toString(), name, address, token)
                wallets = wallets + wallet
                WalletStore.save(context, wallets)
                showAddWallet = false
                refreshWallet(wallet)
            }
        }
    }
}

@Composable
private fun WalletHome(wallets: List<SavedWallet>, payloads: Map<String, WalletPayload>, secondsRemaining: Int, onAdd: () -> Unit, onOpenWallet: (SavedWallet) -> Unit, error: String?) {
    Column(Modifier.fillMaxSize().background(Background).padding(start = 20.dp, end = 20.dp, top = 34.dp, bottom = 28.dp)) {
        Header("MetLP", secondsRemaining, null, onAdd)
        Text("Tracked wallets", color = Muted, fontSize = 14.sp, modifier = Modifier.padding(top = 4.dp, bottom = 20.dp))
        error?.let { Text(it, color = Negative, fontSize = 12.sp, modifier = Modifier.padding(bottom = 10.dp)) }
        if (wallets.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("Add a wallet to start tracking positions.", color = Muted) }
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp), contentPadding = PaddingValues(bottom = 20.dp)) {
                items(wallets, key = { it.id }) { wallet -> WalletCard(wallet, payloads[wallet.id]?.summary) { onOpenWallet(wallet) } }
            }
        }
    }
}

@Composable
private fun WalletPositions(wallet: SavedWallet, payload: WalletPayload?, secondsRemaining: Int, onBack: () -> Unit, onRefresh: () -> Unit) {
    Column(Modifier.fillMaxSize().background(Background).padding(start = 20.dp, end = 20.dp, top = 34.dp, bottom = 28.dp)) {
        Header(wallet.name, secondsRemaining, onBack, onRefresh)
        Text(wallet.address, color = Muted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 4.dp, bottom = 18.dp))
        when {
            payload == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Cyan) }
            payload.positions.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("No open positions.", color = Muted) }
            else -> LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp), contentPadding = PaddingValues(bottom = 20.dp)) { items(payload.positions, key = { it.id }) { PositionRow(it) } }
        }
    }
}

@Composable
private fun Header(title: String, secondsRemaining: Int, onBack: (() -> Unit)?, onAction: () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        if (onBack == null) RefreshRing(secondsRemaining) else IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, "Back", tint = Color.White) }
        Text(title, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 26.sp, modifier = Modifier.padding(start = 10.dp).weight(1f))
        FilledTonalIconButton(onClick = onAction, colors = IconButtonDefaults.filledTonalIconButtonColors(containerColor = Color(0xFF302C43), contentColor = Color.White)) {
            Icon(if (onBack == null) Icons.Default.Add else Icons.Default.Refresh, if (onBack == null) "Add wallet" else "Refresh")
        }
    }
}

@Composable
private fun RefreshRing(secondsRemaining: Int) {
    Canvas(Modifier.size(22.dp)) {
        val progress = (REFRESH_SECONDS - secondsRemaining).toFloat() / REFRESH_SECONDS
        drawCircle(Color(0xFF39354B), style = Stroke(2.dp.toPx()))
        drawArc(Cyan, -90f, 360f * progress, false, style = Stroke(2.dp.toPx(), cap = StrokeCap.Round))
    }
}

@Composable
private fun WalletCard(wallet: SavedWallet, summary: WalletSummary?, onClick: () -> Unit) {
    Surface(color = Surface, shape = MaterialTheme.shapes.small, modifier = Modifier.fillMaxWidth().clickable(onClick = onClick)) {
        Column(Modifier.padding(16.dp)) {
            Text(wallet.name, color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            Text(wallet.address, color = Muted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 3.dp, bottom = 16.dp))
            if (summary == null) LinearProgressIndicator(color = Cyan, trackColor = Color(0xFF39354B), modifier = Modifier.fillMaxWidth()) else {
                Row(Modifier.fillMaxWidth()) {
                    SummaryMetric("TOTAL INVESTED", sol(summary.investedSol), Modifier.weight(1f))
                    SummaryMetric("CURRENT FEES", sol(summary.feesSol), Modifier.weight(1f))
                }
                Row(Modifier.fillMaxWidth().padding(top = 14.dp)) {
                    SummaryMetric("CURRENT PNL", signedSol(summary.pnlSol), Modifier.weight(1f), if (summary.pnlSol >= 0) Positive else Negative)
                    SummaryMetric("POSITIONS", summary.positions.toString(), Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
private fun SummaryMetric(label: String, value: String, modifier: Modifier, valueColor: Color = Color.White) {
    Column(modifier) {
        Text(label, color = Muted, fontSize = 10.sp)
        Text(value, color = valueColor, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, modifier = Modifier.padding(top = 3.dp))
    }
}

@Composable
private fun PositionRow(position: PositionCard) {
    Surface(color = Surface, shape = MaterialTheme.shapes.small) {
        Row(Modifier.fillMaxWidth().heightIn(min = 142.dp).padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text(position.pair, color = Color.White, fontWeight = FontWeight.Bold)
                Text("BALANCE  ${sol(position.balanceSol)}", color = Color(0xFFC9C4D8), fontSize = 12.sp)
                Text("FEES  ${sol(position.feesSol)}", color = Color(0xFFC9C4D8), fontSize = 12.sp)
                Text("PNL  ${signedSol(position.pnlSol)} (${signedPercent(position.pnlPercent)})", color = if (position.pnlSol >= 0) Positive else Negative, fontSize = 12.sp)
                Text("24H FEE / TVL  ${position.feeTvl24hPercent?.let { signedPercent(it) } ?: "COLLECTING"}", color = Color(0xFFF4D8A8), fontSize = 11.sp)
                Text(if (position.inRange) "IN RANGE" else "OUT OF RANGE", color = if (position.inRange) Cyan else Color(0xFFFFC46B), fontSize = 10.sp)
            }
            LiquidityShape(position, Modifier.width(142.dp).height(106.dp))
        }
    }
}

@Composable
private fun LiquidityShape(position: PositionCard, modifier: Modifier) {
    Canvas(modifier) {
        if (position.bins.isEmpty()) return@Canvas
        val step = size.width / position.bins.size
        val activeIndex = position.bins.indexOfFirst { it.binId == position.activeBinId }
        position.bins.forEachIndexed { index, bin ->
            if (bin.liquidity <= 0f) return@forEachIndexed
            val height = (size.height - 16.dp.toPx()) * bin.liquidity
            drawLine(if (bin.side == "left") Cyan else Purple, Offset(index * step + step / 2, size.height), Offset(index * step + step / 2, size.height - height), (step * .65f).coerceAtLeast(1f))
        }
        if (activeIndex >= 0) {
            val x = activeIndex * step + step / 2
            drawLine(Color.White, Offset(x, 0f), Offset(x, size.height), 1.5.dp.toPx(), pathEffect = androidx.compose.ui.graphics.PathEffect.dashPathEffect(floatArrayOf(6f, 6f)))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AddWalletSheet(onDismiss: () -> Unit, onSave: (String, String, String) -> Unit) {
    var name by rememberSaveable { mutableStateOf("") }
    var address by rememberSaveable { mutableStateOf("") }
    var token by rememberSaveable { mutableStateOf("") }
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Surface) {
        Column(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, bottom = 34.dp)) {
            Text("Add wallet", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 22.sp)
            Text("Track open Meteora positions", color = Muted, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp, bottom = 16.dp))
            OutlinedTextField(name, { name = it }, label = { Text("Wallet name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(address, { address = it }, label = { Text("Public wallet address") }, singleLine = true, modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
            OutlinedTextField(token, { token = it }, label = { Text("API token") }, singleLine = true, modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
            Button(onClick = { onSave(name.trim(), address.trim(), token.trim()) }, enabled = name.isNotBlank() && address.length >= 32 && token.length >= 20, modifier = Modifier.fillMaxWidth().padding(top = 14.dp)) { Text("Add wallet") }
        }
    }
}

private fun fetchWallet(wallet: SavedWallet, limit: Int, success: (WalletPayload) -> Unit, failure: (String) -> Unit) {
    thread {
        try {
            val connection = (URL("$API_URL/api/positions?wallet=${wallet.address}&limit=$limit").openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"; setRequestProperty("Authorization", "Bearer ${wallet.token}"); connectTimeout = 10_000; readTimeout = 15_000
            }
            val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
            val body = stream.bufferedReader().use { it.readText() }
            if (connection.responseCode !in 200..299) throw IllegalStateException(JSONObject(body).optString("error", "Request failed"))
            val json = JSONObject(body); val summary = json.getJSONObject("summary"); val data = json.getJSONArray("positions")
            val positions = List(data.length()) { index -> parsePosition(data.getJSONObject(index)) }
            Handler(Looper.getMainLooper()).post { success(WalletPayload(WalletSummary(summary.optDouble("investedSol"), summary.optDouble("currentFeesSol"), summary.optDouble("currentPnlSol"), json.optInt("totalPositions")), positions)) }
        } catch (error: Exception) { Handler(Looper.getMainLooper()).post { failure(error.message ?: "Could not refresh wallet") } }
    }
}

private fun parsePosition(item: JSONObject): PositionCard {
    val liquidity = item.optJSONObject("liquidity"); val bins = liquidity?.optJSONArray("bins")
    return PositionCard(
        id = item.optString("id"), pair = "${item.getJSONObject("pair").optString("base")}/${item.getJSONObject("pair").optString("quote")}",
        balanceSol = item.optDouble("totalBalanceSol"), feesSol = item.optDouble("collectibleFeesSol"), pnlSol = item.optDouble("pnlSol"), pnlPercent = item.optDouble("pnlPercent"),
        feeTvl24hPercent = if (item.isNull("feeTvl24hPercent")) null else item.optDouble("feeTvl24hPercent"), inRange = item.optBoolean("inRange"), activeBinId = liquidity?.optInt("activeBinId"),
        bins = List(bins?.length() ?: 0) { index -> bins!!.getJSONObject(index).let { LiquidityBin(it.optInt("binId"), it.optDouble("liquidity").toFloat(), it.optString("side")) } },
    )
}

private fun sol(value: Double) = String.format(Locale.US, "%.4f SOL", value)
private fun signedSol(value: Double) = String.format(Locale.US, "%+.4f SOL", value)
private fun signedPercent(value: Double) = String.format(Locale.US, "%+.2f%%", value)

private object WalletStore {
    private const val PREFS = "metlp_wallets"; private const val KEY = "wallets"
    fun load(context: Context): List<SavedWallet> = try {
        val list = JSONArray(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "[]"))
        List(list.length()) { index -> list.getJSONObject(index).let { SavedWallet(it.getString("id"), it.getString("name"), it.getString("address"), it.getString("token")) } }
    } catch (_: Exception) { emptyList() }
    fun save(context: Context, wallets: List<SavedWallet>) {
        val list = JSONArray(); wallets.forEach { wallet -> list.put(JSONObject().put("id", wallet.id).put("name", wallet.name).put("address", wallet.address).put("token", wallet.token)) }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, list.toString()).apply()
    }
}
